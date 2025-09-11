import { isArray } from 'class-validator';

export const SaveObjectId = (value: any): string | undefined =>
  value.obj[value.key] ? value.obj[value.key].toString() : undefined;
export const SaveObjectIdArr = (value: any): string | undefined =>
  isArray(value.obj[value.key])
    ? value.obj[value.key].map(it => it.toString())
    : undefined;
