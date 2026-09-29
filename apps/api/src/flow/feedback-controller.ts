import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorDto, OkDto } from './dto.js'
import { ReadersQuery } from './reading-dto.js'
import { CommentInput, CommentListDto, FeedbackContextDto, ReviewInput, ReviewListDto, ReviewStatsDto } from './feedback-dto.js'
import { FeedbackService } from './feedback.js'

@ApiTags('feedback') @ApiBearerAuth()
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 401, type: ErrorDto })
@ApiResponse({ status: 403, type: ErrorDto })
@ApiResponse({ status: 404, type: ErrorDto })
@ApiResponse({ status: 409, type: ErrorDto })
@ApiResponse({ status: 500, type: ErrorDto })
@ApiResponse({ status: 503, type: ErrorDto })
@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('activities/:id/comments') @ApiOperation({ security: [] }) @ApiOkResponse({ type: CommentListDto })
  comments(@Param('id', ParseUUIDPipe) id: string, @Query() query: ReadersQuery) { return this.feedback.comments(id, query.offset) }

  @Get('activities/:id/comments/mine') @ApiOkResponse({ type: CommentListDto })
  mine(@Param('id', ParseUUIDPipe) id: string, @Query() query: ReadersQuery, @Headers('authorization') header?: string) { return this.feedback.comments(id, query.offset, header, true) }

  @Get('activities/:id/reviews') @ApiOperation({ security: [] }) @ApiOkResponse({ type: ReviewListDto })
  reviews(@Param('id', ParseUUIDPipe) id: string, @Query() query: ReadersQuery) { return this.feedback.reviews(id, query.offset) }

  @Get('activities/:id/feedback-context') @ApiOperation({ security: [{}, { bearer: [] }] }) @ApiOkResponse({ type: FeedbackContextDto })
  context(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.feedback.context(id, header) }

  @Get('activities/:id/reviews/stats') @ApiOkResponse({ type: ReviewStatsDto })
  stats(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.feedback.stats(id, header) }

  @Post('activities/:id/comments') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() input: CommentInput, @Headers('authorization') header?: string) { return this.feedback.createComment(id, input, header) }

  @Post('activities/:id/reviews') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  review(@Param('id', ParseUUIDPipe) id: string, @Body() input: ReviewInput, @Headers('authorization') header?: string) { return this.feedback.createReview(id, input, header) }

  @Post('comments/:id/edit') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  editComment(@Param('id', ParseUUIDPipe) id: string, @Body() input: CommentInput, @Headers('authorization') header?: string) { return this.feedback.change('comment', id, input, header) }

  @Post('comments/:id/delete') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  deleteComment(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.feedback.change('comment', id, null, header) }

  @Post('reviews/:id/edit') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  editReview(@Param('id', ParseUUIDPipe) id: string, @Body() input: ReviewInput, @Headers('authorization') header?: string) { return this.feedback.change('review', id, input, header) }

  @Post('reviews/:id/delete') @HttpCode(200) @ApiOkResponse({ type: OkDto })
  deleteReview(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') header?: string) { return this.feedback.change('review', id, null, header) }
}
