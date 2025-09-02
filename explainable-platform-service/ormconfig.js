const dotenv = require('dotenv');
dotenv.config();
const { DataSource } = require('typeorm');

module.exports = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL, 
  synchronize: false,
  logging: true,
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/database/migrations/*.js'],
  subscribers: [],
});