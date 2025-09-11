import { isArray } from 'class-validator';

export const FilterNullInArray = ({ value }: { value: unknown }): unknown =>
  isArray(value) ? value.filter(v => (v === null ? undefined : v)) : [];
