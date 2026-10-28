import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile } from '@nestjs/common'
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AdminService } from '../admin/service.js'
import { ErrorDto } from '../flow/dto.js'
import { AdvertisingAdDto, AdvertisingAdInput, AdvertisingAdListDto, AdvertisingAdminQuery, AdvertisingAdUpdateInput, AdvertisingBackgroundDto, AdvertisingBackgroundInput, AdvertisingImageDto, AdvertisingImageInput, AdvertisingIntroductionDto, AdvertisingIntroductionInput, AdvertisingIntroductionListDto, AdvertisingIntroductionUpdateInput, AdvertisingPublicAdListDto, AdvertisingPublicBackgroundDto, AdvertisingPublicIntroductionDto, AdvertisingPublicQuery, AdvertisingStatusInput } from './dto.js'
import { AdvertisingService } from './service.js'
type Request = { headers: { cookie?:string;origin?:string;'x-csrf-token'?:string } }
const context=(r:Request)=>({cookie:r.headers.cookie,origin:r.headers.origin,csrfToken:r.headers['x-csrf-token']})
@Controller('advertising') @ApiTags('advertising') @ApiResponse({status:404,type:ErrorDto})
export class AdvertisingController {
  constructor(private readonly service:AdvertisingService){}
  @Get('ads') @Header('Cache-Control','no-store') @ApiOperation({security:[]}) @ApiOkResponse({type:AdvertisingPublicAdListDto})
  ads(@Query()query:AdvertisingPublicQuery){return this.service.publicAds(query)}
  @Get('introductions/:id') @Header('Cache-Control','no-store') @ApiOperation({security:[]}) @ApiOkResponse({type:AdvertisingPublicIntroductionDto})
  introduction(@Param('id',ParseUUIDPipe)id:string){return this.service.publicIntroduction(id)}
  @Get('background') @Header('Cache-Control','no-store') @ApiOperation({security:[]}) @ApiOkResponse({type:AdvertisingPublicBackgroundDto})
  async background(){const value=await this.service.background();return {imageUrl:value.imageUrl}}
  @Get('images/:id') @Header('Cache-Control','public, max-age=86400') @Header('X-Content-Type-Options','nosniff') @ApiOperation({security:[]}) @ApiOkResponse({schema:{type:'string',format:'binary'}})
  async image(@Param('id',ParseUUIDPipe)id:string){const value=await this.service.readImage(id);return new StreamableFile(value.bytes,{type:value.mimeType})}
}
@Controller('admin/advertising') @ApiTags('admin-advertising') @ApiCookieAuth('admin_session')
@ApiResponse({status:400,type:ErrorDto}) @ApiResponse({status:401,type:ErrorDto}) @ApiResponse({status:403,type:ErrorDto}) @ApiResponse({status:409,type:ErrorDto})
export class AdminAdvertisingController {
  constructor(private readonly service:AdvertisingService,private readonly admin:AdminService){}
  @Get('images/:id') @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') @ApiOkResponse({schema:{type:'string',format:'binary'}})
  image(@Param('id',ParseUUIDPipe)id:string,@Req()r:Request){return this.admin.withSession(context(r),async tx=>{const value=await this.service.readImage(id,tx,true);return new StreamableFile(value.bytes,{type:value.mimeType})})}
  @Post('images') @HttpCode(200) @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingImageDto})
  upload(@Body()input:AdvertisingImageInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.uploadImage(tx,a.id,input),{write:true})}
  @Get('ads') @Header('Cache-Control','no-store') @ApiOkResponse({type:AdvertisingAdListDto})
  ads(@Query()q:AdvertisingAdminQuery,@Req()r:Request){return this.admin.withSession(context(r),tx=>this.service.listAds(tx,q))}
  @Get('ads/:id') @Header('Cache-Control','no-store') @ApiOkResponse({type:AdvertisingAdDto})
  ad(@Param('id',ParseUUIDPipe)id:string,@Req()r:Request){return this.admin.withSession(context(r),tx=>this.service.ad(tx,id))}
  @Post('ads') @HttpCode(200) @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingAdDto})
  createAd(@Body()input:AdvertisingAdInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.saveAd(tx,a.id,input),{write:true})}
  @Put('ads/:id') @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingAdDto})
  updateAd(@Param('id',ParseUUIDPipe)id:string,@Body()input:AdvertisingAdUpdateInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.saveAd(tx,a.id,input,id,input.version),{write:true})}
  @Post('ads/:id/status') @HttpCode(200) @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingAdDto})
  adStatus(@Param('id',ParseUUIDPipe)id:string,@Body()input:AdvertisingStatusInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.adStatus(tx,a.id,id,input),{write:true})}
  @Get('introductions') @Header('Cache-Control','no-store') @ApiOkResponse({type:AdvertisingIntroductionListDto})
  introductions(@Query()q:AdvertisingAdminQuery,@Req()r:Request){return this.admin.withSession(context(r),tx=>this.service.listIntroductions(tx,q))}
  @Get('introductions/:id') @Header('Cache-Control','no-store') @ApiOkResponse({type:AdvertisingIntroductionDto})
  introduction(@Param('id',ParseUUIDPipe)id:string,@Req()r:Request){return this.admin.withSession(context(r),tx=>this.service.introduction(tx,id))}
  @Post('introductions') @HttpCode(200) @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingIntroductionDto})
  createIntroduction(@Body()input:AdvertisingIntroductionInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.saveIntroduction(tx,a.id,input),{write:true})}
  @Put('introductions/:id') @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingIntroductionDto})
  updateIntroduction(@Param('id',ParseUUIDPipe)id:string,@Body()input:AdvertisingIntroductionUpdateInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.saveIntroduction(tx,a.id,input,id,input.version),{write:true})}
  @Post('introductions/:id/status') @HttpCode(200) @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingIntroductionDto})
  introductionStatus(@Param('id',ParseUUIDPipe)id:string,@Body()input:AdvertisingStatusInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.introductionStatus(tx,a.id,id,input),{write:true})}
  @Get('background') @Header('Cache-Control','no-store') @ApiOkResponse({type:AdvertisingBackgroundDto})
  background(@Req()r:Request){return this.admin.withSession(context(r),tx=>this.service.background(tx))}
  @Put('background') @ApiHeader({name:'X-CSRF-Token',required:true}) @ApiOkResponse({type:AdvertisingBackgroundDto})
  saveBackground(@Body()input:AdvertisingBackgroundInput,@Req()r:Request){return this.admin.withSession(context(r),(tx,a)=>this.service.saveBackground(tx,a.id,input),{write:true})}
}
