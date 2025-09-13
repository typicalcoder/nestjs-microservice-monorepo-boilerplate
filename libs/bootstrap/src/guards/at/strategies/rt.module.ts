import {
  ConfigurableModuleBuilder,
  FactoryProvider,
  Module,
} from "@nestjs/common";

import { RtConfig, RtStrategy } from "./rt.strategy";

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<RtConfig>().build();

const rtProvider: FactoryProvider<RtStrategy> = {
  inject: [MODULE_OPTIONS_TOKEN],
  provide: RtStrategy,
  useFactory: (config: RtConfig): RtStrategy => new RtStrategy(config),
};

@Module({
  providers: [rtProvider],
  exports: [rtProvider],
})
export class RtModule extends ConfigurableModuleClass {}
