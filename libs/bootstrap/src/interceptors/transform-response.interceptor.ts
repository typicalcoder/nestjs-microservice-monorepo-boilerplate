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
            Object.entries(data).filter(([k]) => !k.startsWith('__')),
          ) as Partial<T>;
        }
        if (isArray(data)) {
          return data.map(item =>
            isObject(item as unknown)
              ? Object.fromEntries(
                  Object.entries(item as object).filter(
                    ([k]) => !k.startsWith('__'),
                  ),
                )
              : (item as unknown),
          ) as unknown as Partial<T>;
        }
        return data as Partial<T>;
      }),
    );
  }
}
