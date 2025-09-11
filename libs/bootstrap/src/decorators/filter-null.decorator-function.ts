export const FilterNull = ({
  value,
}: {
  value: any | null;
}): any | undefined => (value === null ? undefined : value);
