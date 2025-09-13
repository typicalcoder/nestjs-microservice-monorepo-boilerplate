import {
  ConfigurableModuleBuilder,
  FactoryProvider,
  Module,
} from "@nestjs/common";

import { AtConfig, AtStrategy } from "./at.strategy";

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<AtConfig>().build();

const atProvider: FactoryProvider<AtStrategy> = {
  inject: [MODULE_OPTIONS_TOKEN],
  provide: AtStrategy,
  useFactory: (config: AtConfig): AtStrategy => new AtStrategy(config),
};

@Module({
  providers: [atProvider],
  exports: [atProvider],
})
export class AtModule extends ConfigurableModuleClass {}
