import { isArray } from 'class-validator';

export const FilterEmptyArray = ({
  value,
}: {
  value: any[];
}): any[] | undefined => (isArray(value) && value.length ? value : undefined);
