export const FilterNull = ({ value }: { value: unknown }): unknown =>
  value === null ? undefined : value;
