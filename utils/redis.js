import redis from 'redis';
import { promisify } from 'util';

class RedisClient {
  constructor() {
    this.client = redis.createClient();
    this.client.on('error', (err) => console.log(`Redis client not connected to the server: ${err}`));
  }

  isAlive() {
    return this.client.connected;
  }

  async get(key) {
    const getValue = await promisify(this.client.get).bind(this.client, key);
    const value = await getValue();
    return value;
  }

  async set(key, value, duration) {
    const setex = await promisify(this.client.setex).bind(this.client);
    await setex(key, duration, value);
  }

  async del(key) {
    const del = await promisify(this.client.del).bind(this.client);
    await del(key);
  }
}
const redisClient = new RedisClient();
export default redisClient;
