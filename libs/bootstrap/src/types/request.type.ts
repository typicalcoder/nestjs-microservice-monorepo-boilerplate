import * as QueryString from 'querystring';
import * as express from 'express';
import { UserEntity } from '@bootstrap/repository/entities/user.entity';
import { JwtPayload } from '@bootstrap/types/jwtPayload.type';

export type RequestUserInfo = JwtPayload & {
  entity: UserEntity;
};

export interface ParamsDictionary {
  [key: string]: string;
}

export interface LixRequest<
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = QueryString.ParsedUrlQuery,
  Locals extends Record<string, any> = Record<string, any>,
> extends express.Request<P, ResBody, ReqBody, ReqQuery, Locals> {
  service?: string;
  i18nLang?: string;
  user: RequestUserInfo;
}
