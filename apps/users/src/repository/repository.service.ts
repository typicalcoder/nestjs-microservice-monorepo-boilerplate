import { ObjectId } from 'bson';
import { LixRpcException } from '@bootstrap/errors';
import { UserEntity } from '@bootstrap/repository/entities/user.entity';

import { GetUserCommandRequestPayload } from '@microservice/lib/commands/users';
import { CreateUserCommandRequestPayload } from '@microservice/lib/commands/users/create.users.command-payload';

import { FilterQuery, ValidationError } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/mongodb';
import { InjectRepository } from '@mikro-orm/nestjs';
import { HttpStatus, Injectable } from '@nestjs/common';

@Injectable()
export class RepositoryService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: EntityRepository<UserEntity>,
  ) {}

  async get(data: GetUserCommandRequestPayload): Promise<UserEntity> {
    try {
      return await this.userRepository.findOneOrFail({
        ...(data.id ? { _id: new ObjectId(data.id) } : {}),
        ...(data.phone ? { phone: data.phone } : {}),
      });
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw new LixRpcException(
          error.name,
          HttpStatus.NOT_FOUND,
          error.message,
        );
      }
      throw error;
    }
  }

  async create(data: CreateUserCommandRequestPayload): Promise<UserEntity> {
    try {
      const newUser = this.userRepository.create(data);
      await this.userRepository.getEntityManager().persistAndFlush(newUser);
      return newUser;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw new LixRpcException(
          error.name,
          HttpStatus.INTERNAL_SERVER_ERROR,
          error.message,
          error,
        );
      }
      throw error;
    }
  }

  async list(filter: FilterQuery<UserEntity>): Promise<UserEntity[]> {
    return await this.userRepository.find(filter);
  }
}
