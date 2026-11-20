import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler.js';
import { rateLimit } from './common/middleware/rate-limit.js';
import { requestId } from './common/middleware/request-id.js';
import { storage, LocalStorageService } from './infrastructure/storage/index.js';
import { createLocalStorageRouter } from './infrastructure/storage/local-storage.routes.js';
import { classroomsRouter } from './modules/classrooms/classrooms.routes.js';
import { coursesRouter } from './modules/courses/courses.routes.js';
import { sectionsRouter } from './modules/sections/sections.routes.js';
import { plansRecordsRouter } from './modules/registrations/plans-records.routes.js';
import { registrationsRouter } from './modules/registrations/registrations.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { calendarRouter } from './modules/academic-sessions/calendar.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { peopleAdminRouter } from './modules/administrators/administrators.routes.js';
import { degreesRouter } from './modules/degrees/degrees.routes.js';
import { facultyRouter } from './modules/faculty/faculty.routes.js';
import { importsRouter } from './modules/imports/imports.routes.js';
import { studentsRouter } from './modules/students/students.routes.js';
import { departmentsRouter } from './modules/departments/departments.routes.js';
import { gradingScalesRouter } from './modules/grading-scales/grading-scales.routes.js';
import { programsRouter } from './modules/programs/programs.routes.js';
import { schoolsRouter } from './modules/schools/schools.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { rbacRouter } from './modules/rbac/rbac.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { universityRouter } from './modules/university/university.routes.js';
import { generateOpenApiDocument } from './openapi/registry.js';

export const API_PREFIX = '/api/v1';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'extended');

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      maxAge: 600,
      exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
    }),
  );
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url?.startsWith(`${API_PREFIX}/health`) ?? false },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  const api = Router();
  // Health is excluded from the global rate limit so probes never get 429.
  api.use(healthRouter);
  api.use(
    rateLimit({
      name: 'global',
      points: env.RATE_LIMIT_GLOBAL_PER_MINUTE,
      durationSeconds: 60,
      key: (req) => req.ip ?? 'unknown',
    }),
  );
  if (storage instanceof LocalStorageService) {
    // Raw upload bodies: mounted before the JSON parser.
    api.use(createLocalStorageRouter(storage));
  }
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use(universityRouter);
  api.use(authRouter);
  api.use(rbacRouter);
  api.use(auditRouter);
  api.use(schoolsRouter);
  api.use(departmentsRouter);
  api.use(degreesRouter);
  api.use(programsRouter);
  api.use(calendarRouter);
  api.use(gradingScalesRouter);
  api.use(studentsRouter);
  api.use(facultyRouter);
  api.use(peopleAdminRouter);
  api.use(classroomsRouter);
  api.use(coursesRouter);
  api.use(sectionsRouter);
  api.use(registrationsRouter);
  api.use(plansRecordsRouter);
  api.use(notificationsRouter);
  api.use(importsRouter);
  app.use(API_PREFIX, api);

  if (env.API_DOCS_ENABLED) {
    const document = generateOpenApiDocument();
    app.get('/api/docs/openapi.json', (_req, res) => {
      res.json(document);
    });
    app.use(
      '/api/docs',
      helmet({
        contentSecurityPolicy: {
          directives: {
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
          },
        },
      }),
      swaggerUi.serve,
      swaggerUi.setup(document, { customSiteTitle: 'UCRAMS API' }),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
