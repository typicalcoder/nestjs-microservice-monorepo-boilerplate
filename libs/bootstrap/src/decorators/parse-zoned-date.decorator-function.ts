import { isDate, isString } from 'class-validator';
import { parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

export const ParseZonedDate = ({
  value,
}: {
  value: string | Date;
}): Date | undefined => {
  if (isDate(value)) {
    return value;
  }
  if (!isString(value)) {
    return;
  }
  if (value.includes('Z')) {
    return parseISO(value);
  } else {
    return fromZonedTime(value, 'Europe/Moscow');
  }
};
