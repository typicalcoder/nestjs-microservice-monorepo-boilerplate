import { EnvType } from '@bootstrap/base-config';
import { getLogger } from '@bootstrap/logger';

import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { Config } from '../../config';
import { swaggerCssStyles } from './swagger-css-styles';

export function setupSwagger(
  app: INestApplication,
  config: Config,
  meta: { name: string; version: string },
): void {
  if (config.NODE_ENV === EnvType.PROD) {
    return;
  }
  const { name, version } = meta;

  const docConfig = new DocumentBuilder()
    .setTitle(`${name || 'app'}`)
    .setDescription('BuddJet Server API')
    .setVersion(version ?? 'local')
    .addBearerAuth();
  if (config.NODE_ENV === EnvType.LOCAL) {
    docConfig.addServer(`http://localhost:${config.PORT}`, 'Local instance');
  }

  docConfig.addServer('https://dev.buddjet.ru', 'Development stage');
  docConfig.addServer('https://api.buddjet.ru', 'Production stage');

  const document = SwaggerModule.createDocument(app, docConfig.build());

  SwaggerModule.setup('/doc', app, document, {
    customCss: swaggerCssStyles,
  });
  getLogger().info("Swagger initialized on path: '/doc'");
}
