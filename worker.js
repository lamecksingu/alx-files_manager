const fs = require('fs');
const { ObjectId } = require('mongodb');
const imageThumbnail = require('image-thumbnail');
const dbClient = require('./utils/db');
const fileQueue = require('./utils/queue');

fileQueue.process(async (job) => {
  const { userId, fileId } = job.data;

  if (!userId) {
    throw new Error('Missing userId');
  }

  if (!fileId) {
    throw new Error('Missing fileId');
  }

  const file = await dbClient.db.collection('files').findOne({
    _id: ObjectId(fileId),
    userId
  });

  if (!file) {
    throw new Error('File not found');
  }

  if (file.type !== 'image') {
    return;
  }

  try {
    const sizes = [100, 250, 500];
    for (const size of sizes) {
      const thumbnail = await imageThumbnail(file.localPath, { width: size, height: size });
      const thumbnailPath = `${file.localPath}_${size}.jpg`;
      await fs.promises.writeFile(thumbnailPath, thumbnail);
    }
  } catch (error) {
    console.error('Error generating thumbnails:', err);
    throw new Error('Failed to generate thumbnails');
  }
});

console.log('Worker is ready');
