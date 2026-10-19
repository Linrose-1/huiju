import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common'
import { ApiCookieAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto } from '../flow/dto.js'
import { AnalyticsDashboardDto, AnalyticsEventListDto, AnalyticsMemberListDto, AnalyticsMemberQuery, AnalyticsQuery } from './analytics-dto.js'
import { AnalyticsService } from './analytics-service.js'
import { AdminService } from './service.js'

export function csvCell(value: string | number | null) {
  let text = String(value ?? '')
  if (/^[\s]*[=+@-]/.test(text)) text = "'"+text
  return '"'+text.replaceAll('"','""')+'"'
}
@ApiTags('admin-analytics') @ApiCookieAuth('admin_session')
@ApiResponse({ status: 401, type: ErrorDto }) @ApiResponse({ status: 403, type: ErrorDto })
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly admin: AdminService, private readonly analytics: AnalyticsService) {}
  @Get() @Header('Cache-Control','no-store') @ApiOkResponse({ type: AnalyticsDashboardDto })
  dashboard(@Query() query: AnalyticsQuery, @Req() request: { headers: { cookie?: string } }) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx=>this.analytics.dashboard(tx,query.days))
  }
  @Get('members') @Header('Cache-Control','no-store') @ApiOkResponse({ type: AnalyticsMemberListDto })
  members(@Query() query: AnalyticsMemberQuery, @Req() request: { headers: { cookie?: string } }) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx=>this.analytics.memberList(tx,query))
  }
  @Get('members/:id/events') @Header('Cache-Control','no-store') @ApiOkResponse({ type: AnalyticsEventListDto })
  events(@Param('id', ParseUUIDPipe) id: string, @Query() query: AnalyticsMemberQuery, @Req() request: { headers: { cookie?: string } }) {
    return this.admin.withSession({ cookie: request.headers.cookie }, tx=>this.analytics.events(tx,id,query))
  }
  @Get('export') @Header('Cache-Control','no-store') @Header('Content-Type','text/csv; charset=utf-8')
  @Header('Content-Disposition','attachment; filename="member-activity.csv"') @ApiOkResponse({ schema: { type: 'string' } })
  export(@Query() query: AnalyticsMemberQuery, @Req() request: { headers: { cookie?: string } }) {
    return this.admin.withSession({ cookie: request.headers.cookie }, async tx=> {
      const lines = ['会员编号,用户名称,浏览次数,报名次数,到场次数,发起次数,评论次数,点评次数,最近活跃时间']
      const now = new Date()
      for (let offset=0; ; offset+=40) {
        const page = await this.analytics.memberList(tx,{...query,offset},now)
        lines.push(...page.items.map(row=>[row.memberNumber,row.displayName,row.browse,row.register,row.attend,row.publish,row.comment,row.review,row.lastActiveAt].map(csvCell).join(',')))
        if (!page.hasMore) break
      }
      return '\uFEFF'+lines.join('\r\n')
    })
  }
}
