import { LixRpcException } from "@bootstrap/errors";
import { ObjectId } from "bson";

import { EntityRepository } from "@mikro-orm/mongodb";
import { InjectRepository } from "@mikro-orm/nestjs";
import { HttpStatus, Injectable } from "@nestjs/common";

import { RefreshTokenEntity } from "./refresh-token.entity";

@Injectable()
export class RefreshService {
  constructor(
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: EntityRepository<RefreshTokenEntity>,
  ) {}

  async add(userId: string, refreshToken: string): Promise<void> {
    const newToken = this.refreshTokenRepository.create({
      user: new ObjectId(userId),
      token: refreshToken,
    });

    await this.refreshTokenRepository
      .getEntityManager()
      .persistAndFlush(newToken);
  }

  async invalidateOrThrow(filter: {
    refreshToken?: string;
    userId?: string;
  }): Promise<void> {
    if (!filter.refreshToken && !filter.userId) {
      return;
    }
    try {
      const token = await this.refreshTokenRepository.findOneOrFail({
        ...(filter.refreshToken && { token: filter.refreshToken }),
        ...(filter.userId && { user: new ObjectId(filter.userId) }),
      });

      await this.refreshTokenRepository
        .getEntityManager()
        .remove(token)
        .flush();
    } catch (e) {
      throw new LixRpcException(
        "RefreshInvalidateFailed",
        HttpStatus.INTERNAL_SERVER_ERROR,
        "Refresh token was not invalidated",
        e,
      );
    }
  }
}
