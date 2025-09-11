import { isArray, isObject } from 'class-validator';
import { map, Observable } from 'rxjs';

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, Partial<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Partial<T>> {
    return next.handle().pipe(
      map(data => {
        if (isObject(data)) {
          return Object.fromEntries(
            Object.entries(data).filter(([k, v]) => !k.startsWith('__')),
          );
        }
        if (isArray(data)) {
          return data.map(item =>
            Object.fromEntries(
              Object.entries(item).filter(([k, v]) => !k.startsWith('__')),
            ),
          );
        }
        return data;
      }),
    );
  }
}
