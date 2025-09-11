import { isArray } from 'class-validator';

export const FilterNullInArray = ({
  value,
}: {
  value: any | null;
}): any | undefined =>
  isArray(value) ? value.filter(v => (v === null ? undefined : v)) : [];
