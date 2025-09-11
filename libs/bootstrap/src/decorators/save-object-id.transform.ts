import { isArray } from 'class-validator';

export const SaveObjectId = (value: unknown): string | undefined => {
  if (
    value &&
    typeof value === 'object' &&
    value !== null &&
    'obj' in value &&
    'key' in value
  ) {
    const obj = value.obj as Record<string, unknown>;
    const key = value.key as string;
    const objValue = obj[key];

    if (objValue) {
      // Просто возвращаем строковое представление значения
      return JSON.stringify(objValue);
    }
  }
  return undefined;
};

export const SaveObjectIdArr = (value: unknown): string | undefined => {
  if (
    value &&
    typeof value === 'object' &&
    value !== null &&
    'obj' in value &&
    'key' in value
  ) {
    const obj = value.obj as Record<string, unknown>;
    const key = value.key as string;
    const objValue = obj[key];

    if (isArray(objValue)) {
      // Преобразуем массив в строку
      return JSON.stringify(objValue);
    }
  }
  return undefined;
};
