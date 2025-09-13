import { isBoolean, isString } from "class-validator";

export const ParseBoolean = ({ value }: { value: unknown }): boolean =>
  value
    ? isBoolean(value)
      ? value
      : isString(value)
        ? value.toLowerCase() === "true"
        : false
    : false;
