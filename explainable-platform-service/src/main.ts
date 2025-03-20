import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './auth/roles.guard';
import * as passport from 'passport';

async function bootstrap() {
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
