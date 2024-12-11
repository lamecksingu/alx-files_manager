const fs = require('fs');
const { ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const dbClient = require('../utils/db');
const redisClient = require('../utils/redis');
const fileQueue = require('../utils/queue');

const postUpload = async (req, res) => {
  const token = req.get('X-Token');
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const redisTokenKey = `auth_${token}`;
  const userId = await redisClient.get(redisTokenKey);
  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const user = await dbClient.db.collection('users').findOne({ _id: ObjectId(userId) });
  if (!user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const {
    name, type, parentId, isPublic, data,
  } = req.body;
  if (!name) {
    return res.status(400).send({ error: 'Missing name' });
  }

  if (!type) {
    return res.status(400).send({ error: 'Missing type' });
  }

  if (!data && type !== 'folder') {
    return res.status(400).send({ error: 'Missing data' });
  }

  if (parentId) {
    const parent = await dbClient.db.collection('files').findOne({ _id: ObjectId(parentId) });
    if (!parent) {
      return res.status(400).send({ error: 'Parent not found' });
    }

    if (parent.type !== 'folder') {
      return res.status(400).send({ error: 'Parent is not a folder' });
    }
  }

  const file = {
    userId,
    name,
    type,
    parentId: parentId || 0,
    isPublic: isPublic || false,
    data: data || null,
  };

  if (type === 'folder') {
    const newFile = await dbClient.db.collection('files').insertOne(file);
    const { _id, ...fileInfo } = newFile.ops[0];
    return res.status(201).send({ id: _id, ...fileInfo });
  }

  const path = process.env.FOLDER_PATH || '/tmp/files_manager';
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }

  const buff = Buffer.from(data, 'base64');
  const filePath = `${path}/${uuidv4()}`;

  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, buff, async (error) => {
      if (error) {
        return reject(res.status(500).send({ error: 'Cannot write the file' }));
      }

      const newFile = await dbClient.db.collection('files').insertOne({ ...file, localPath: filePath });
      if (newFile.type === 'image') {
        fileQueue.add({ userId, fileId: newFile.insertedId });
      }
      return resolve(res.status(201).send({ id: newFile.insertedId, ...file }));
    });
  });
};

const getShow = async (req, res) => {
  const fileId = req.params.id;

  const token = req.get('X-Token');
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const redisTokenKey = `auth_${token}`;
  const uId = await redisClient.get(redisTokenKey);
  if (!uId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const user = await dbClient.db.collection('users').findOne({ _id: ObjectId(uId) });
  if (!user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: uId });
  if (!file) {
    return res.status(404).send({ error: 'Not found' });
  }

  const filesList = {
    id: file._id,
    userId: file.userId,
    name: file.name,
    type: file.type,
    isPublic: file.isPublic,
    parentId: file.parentId,
  };

  return res.status(200).send({ ...filesList });
};

const getIndex = async (req, res) => {
  const parentId = req.query.parentId ? parseInt(req.query.parentId, 10) : undefined;
  const page = parseInt(req.query.page, 10) || 0;

  const token = req.get('X-Token');
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const redisTokenKey = `auth_${token}`;
  const userId = await redisClient.get(redisTokenKey);
  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const user = await dbClient.db.collection('users').findOne({ _id: ObjectId(userId) });
  if (!user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const matchCondition = { userId };

  if (parentId !== undefined) {
    matchCondition.parentId = parentId;
  }

  const files = await dbClient.db.collection('files').aggregate([
    { $match: matchCondition },
    { $skip: page * 20 },
    { $limit: 20 },
  ]).toArray();

  const filesList = files.map((file) => {
    const { _id, ...fileInfo } = file;
    delete fileInfo.data;
    delete fileInfo.localPath;
    return { id: _id, ...fileInfo };
  });

  return res.status(200).send(filesList);
};

const putPublish = async (req, res) => {
  const fileId = req.params.id;
  const token = req.get('X-Token');
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const uId = await redisClient.get(`auth_${token}`);
  if (!uId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const user = await dbClient.db.collection('users').findOne({ _id: ObjectId(uId) });
  if (!user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: uId });
  if (!file) {
    return res.status(404).send({ error: 'Not found' });
  }

  if (!file.isPublic) {
    await dbClient.db.collection('files').updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: true } });
  }

  const fileObj = {
    id: file._id,
    userId: file.userId,
    name: file.name,
    type: file.type,
    isPublic: !file.isPublic,
    parentId: file.parentId,
  };

  return res.status(200).send(fileObj);
};

const putUnpublish = async (req, res) => {
  const fileId = req.params.id;
  const token = req.get('X-Token');
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const uId = await redisClient.get(`auth_${token}`);
  if (!uId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const user = await dbClient.db.collection('users').findOne({ _id: ObjectId(uId) });
  if (!user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: uId });
  if (!file) {
    return res.status(404).send({ error: 'Not found' });
  }

  if (file.isPublic) {
    await dbClient.db.collection('files').updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: false } });
  }

  const fileObj = {
    id: file._id,
    userId: file.userId,
    name: file.name,
    type: file.type,
    isPublic: !file.isPublic,
    parentId: file.parentId,
  };

  return res.status(200).send(fileObj);
};

const getFile = async (req, res) => {
  const { size } = req.query;
  const fileId = req.params.id;
  const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId) });
  if (!file) {
    return res.status(404).send({ error: 'Not found' });
  }

  if (file.isPublic === false) {
    const token = req.get('X-Token');
    if (!token) {
      return res.status(404).send({ error: 'Not found' });
    }

    const uId = await redisClient.get(`auth_${token}`);
    if (!uId) {
      return res.status(404).send({ error: 'Not found' });
    }

    if (file.userId !== uId) {
      return res.status(404).send({ error: 'Not found' });
    }
  }

  if (file.type === 'folder') {
    return res.status(400).send({ error: 'A folder doesn\'t have content' });
  }

  if (!fs.existsSync(file.localPath)) {
    return res.status(404).send({ error: 'Not found' });
  }

  const mimeType = mime.lookup(file.name);
  res.setHeader('Content-Type', mimeType);

  if (size) {
    if (size === '500' || size === '250' || size === '100') {
      const resizedFilePath = `${file.localPath}_${size}`;
      if (!fs.existsSync(resizedFilePath)) {
        return res.status(404).send({ error: 'Not found' });
      }

      const resizedFileData = fs.readFileSync(resizedFilePath);
      return res.status(200).send(resizedFileData);
    }
  }

  const fileData = fs.readFileSync(file.localPath);
  return res.status(200).send(fileData);
};

module.exports = {
  postUpload,
  getShow,
  getIndex,
  putPublish,
  putUnpublish,
  getFile,
};
