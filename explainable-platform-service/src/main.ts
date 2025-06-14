import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './auth/roles.guard';
import * as passport from 'passport';
import axios from 'axios';

const color = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

function shortenJsonData(data: any, length = 500): string {
  const json = JSON.stringify(data);
  if (json.length <= length * 2) return json;
  const head = json.slice(0, length);
  const tail = json.slice(-length);
  return `${head}...${tail}`;
}

async function bootstrap() {
  axios.interceptors.request.use((config) => {
    console.log(`${color.green}[HTTP:Outbound]${color.reset} ${config.method?.toUpperCase()} ${config.url}`);
    if (config.data) {
      console.log(`${color.green}[HTTP:Outbound:Payload]${color.reset}`, shortenJsonData(config.data));
    }
    return config;
  });
  
  axios.interceptors.response.use((response) => {
    console.log(`${color.yellow}[HTTP:Inbound]${color.reset} ${response.status} ${response.config.url}`);
    if (response.data) {
      console.log(`${color.yellow}[HTTP:Inbound: Body]${color.reset}`, shortenJsonData(response.data));
    }
    return response;
  }, (error) => {
    console.error(`[HTTP:Error] ${error.message}`);
    return Promise.reject(error);
  });

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Authorization',
  });
  const reflector = app.get(Reflector);
  app.use(passport.initialize());
  app.useGlobalGuards(new RolesGuard(reflector));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
