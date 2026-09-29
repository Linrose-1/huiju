import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { ActivityDraftInput, ActivityDraftResultDto } from './dto.js'
import { ActivityDraftService } from './service.js'

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class ActivityDraftController {
  constructor(private readonly drafts: ActivityDraftService) {}

  @Post('activity-drafts') @HttpCode(200) @ApiOkResponse({ type: ActivityDraftResultDto })
  create(@Body() input: ActivityDraftInput, @Headers('authorization') header?: string) {
    return this.drafts.create(input.idea, header)
  }
}
