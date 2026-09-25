import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger'

class HealthResponse {
  @ApiProperty({ enum: ['ok'] })
  status = 'ok' as const
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ type: HealthResponse })
  getHealth(): HealthResponse {
    return new HealthResponse()
  }
}
