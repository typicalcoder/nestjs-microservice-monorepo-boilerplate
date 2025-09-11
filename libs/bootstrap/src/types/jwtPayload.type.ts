export type JwtPayload = {
  exp: number;
  iat: number;
  salt: string;
  sub: string;
};
