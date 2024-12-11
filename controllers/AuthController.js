const uuid = require('uuid');
const sha1 = require('sha1');
const dbClient = require('../utils/db');
const redisClient = require('../utils/redis');

const connect = async (req, res) => {
  const auth = req.get('Authorization');
  if (!auth) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  if (!auth.startsWith('Basic ')) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const base64Credentials = auth.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [email, password] = credentials.split(':');
  const hashedPassword = sha1(password);
  const user = await dbClient.db.collection('users').findOne({ email, password: hashedPassword });
  if (!user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const token = uuid.v4();
  const key = `auth_${token}`;
  await redisClient.set(key, user._id.toString(), 86400);

  return res.status(200).send({ token });
};

const disconnect = async (req, res) => {
  const token = req.get('X-Token');
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const key = `auth_${token}`;
  const userId = await redisClient.get(key);
  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  await redisClient.del(key);
  return res.status(204).send();
};

module.exports = {
  connect,
  disconnect,
};
