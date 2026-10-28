import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import { PageQuery } from '../flow/pagination.js'
const trim = ({value}: {value: unknown}) => typeof value === 'string' ? value.trim() : value
export const placements = ['activity', 'circle', 'assistant'] as const
export const statuses = ['draft', 'published', 'offline'] as const
export class AdvertisingBlockInput {
  @ApiProperty({enum:['text','image']}) @IsIn(['text','image']) type!: 'text'|'image'
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) text?: string
  @ApiPropertyOptional() @IsOptional() @IsUUID() imageId?: string
}
export class AdvertisingBlockDto extends AdvertisingBlockInput {
  @ApiPropertyOptional() imageUrl?: string
}
export class AdvertisingIntroductionInput {
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(100) name!: string
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(200) companyName!: string
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(100) contactName!: string
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(40) phone!: string
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(100) wechatId!: string
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(500) summary!: string
  @ApiProperty({type:String,nullable:true}) @ValidateIf((_o,v)=>v!==null) @IsUUID() coverImageId!: string|null
  @ApiProperty({type:[AdvertisingBlockInput]}) @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>AdvertisingBlockInput) blocks!: AdvertisingBlockInput[]
}
export class AdvertisingIntroductionUpdateInput extends AdvertisingIntroductionInput {
  @ApiProperty() @IsInt() @Min(1) version!: number
}
export class AdvertisingIntroductionDto extends AdvertisingIntroductionInput {
  @ApiProperty() id!: string
  @ApiProperty() version!: number
  @ApiProperty({enum:statuses}) status!: typeof statuses[number]
  @ApiProperty({type:String,nullable:true}) coverImageUrl!: string|null
  @ApiProperty({type:String,nullable:true}) coverSourceImageId!: string|null
  @ApiProperty({type:String,nullable:true}) coverSourceImageUrl!: string|null
  @ApiProperty({type:[AdvertisingBlockDto]}) declare blocks: AdvertisingBlockDto[]
  @ApiProperty() createdAt!: string
  @ApiProperty() updatedAt!: string
}
export class AdvertisingAdInput {
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(100) title!: string
  @ApiProperty() @IsUUID() introductionId!: string
  @ApiProperty({enum:placements,isArray:true}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique() @IsIn(placements,{each:true}) placements!: (typeof placements[number])[]
  @ApiProperty({type:String,nullable:true}) @ValidateIf((_o,v)=>v!==null) @IsUUID() wideImageId!: string|null
  @ApiProperty({type:String,nullable:true}) @ValidateIf((_o,v)=>v!==null) @IsUUID() tallImageId!: string|null
  @ApiProperty() @IsInt() @Min(-1000000) @Max(1000000) sortOrder!: number
}
export class AdvertisingAdUpdateInput extends AdvertisingAdInput { @ApiProperty() @IsInt() @Min(1) version!: number }
export class AdvertisingAdDto extends AdvertisingAdInput {
  @ApiProperty() id!: string
  @ApiProperty() version!: number
  @ApiProperty({enum:statuses}) status!: typeof statuses[number]
  @ApiProperty({type:String,nullable:true}) wideImageUrl!: string|null
  @ApiProperty({type:String,nullable:true}) tallImageUrl!: string|null
  @ApiProperty({type:String,nullable:true}) wideSourceImageId!: string|null
  @ApiProperty({type:String,nullable:true}) wideSourceImageUrl!: string|null
  @ApiProperty({type:String,nullable:true}) tallSourceImageId!: string|null
  @ApiProperty({type:String,nullable:true}) tallSourceImageUrl!: string|null
  @ApiProperty() createdAt!: string
  @ApiProperty() updatedAt!: string
}
export class AdvertisingStatusInput {
  @ApiProperty() @IsInt() @Min(1) version!: number
  @ApiProperty({enum:['published','offline']}) @IsIn(['published','offline']) status!: 'published'|'offline'
}
export class AdvertisingAdminQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q: string = ''
  @ApiPropertyOptional({enum:['all',...statuses]}) @IsOptional() @IsIn(['all',...statuses]) status: 'all'|typeof statuses[number] = 'all'
  @ApiPropertyOptional({enum:['all',...placements]}) @IsOptional() @IsIn(['all',...placements]) placement: 'all'|typeof placements[number] = 'all'
}
export class AdvertisingPublicQuery extends PageQuery { @ApiProperty({enum:placements}) @IsIn(placements) placement!: typeof placements[number] }
export class AdvertisingAdListDto { @ApiProperty({type:[AdvertisingAdDto]}) items!: AdvertisingAdDto[]; @ApiProperty() total!: number; @ApiProperty() hasMore!: boolean }
export class AdvertisingIntroductionListDto { @ApiProperty({type:[AdvertisingIntroductionDto]}) items!: AdvertisingIntroductionDto[]; @ApiProperty() total!: number; @ApiProperty() hasMore!: boolean }
export class AdvertisingPublicAdDto { @ApiProperty() id!: string; @ApiProperty() title!: string; @ApiProperty() introductionId!: string; @ApiProperty() imageUrl!: string }
export class AdvertisingPublicAdListDto { @ApiProperty({type:[AdvertisingPublicAdDto]}) items!: AdvertisingPublicAdDto[]; @ApiProperty() total!: number; @ApiProperty() hasMore!: boolean }
export class AdvertisingBackgroundInput { @ApiProperty({type:String,nullable:true}) @ValidateIf((_o,v)=>v!==null) @IsUUID() imageId!: string|null; @ApiProperty() @IsInt() @Min(0) version!: number }
export class AdvertisingBackgroundDto extends AdvertisingBackgroundInput {
  @ApiProperty({type:String,nullable:true}) imageUrl!: string|null
  @ApiProperty({type:String,nullable:true}) sourceImageId!: string|null
  @ApiProperty({type:String,nullable:true}) sourceImageUrl!: string|null
}
export class AdvertisingImageInput {
  @ApiProperty() @IsString() @MaxLength(6990508) base64!: string
  @ApiProperty({enum:['image/png','image/jpeg']}) @IsIn(['image/png','image/jpeg']) mimeType!: 'image/png'|'image/jpeg'
  @ApiProperty({enum:['source','wide','tall','detail']}) @IsIn(['source','wide','tall','detail']) purpose!: 'source'|'wide'|'tall'|'detail'
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceImageId?: string
}
export class AdvertisingImageDto {
  @ApiProperty() id!: string; @ApiProperty() url!: string; @ApiProperty() width!: number; @ApiProperty() height!: number
  @ApiProperty({enum:['source','wide','tall','detail']}) purpose!: AdvertisingImageInput['purpose']
  @ApiProperty({type:String,nullable:true}) sourceImageId!: string|null
  @ApiProperty({type:String,nullable:true}) sourceImageUrl!: string|null
}
export class AdvertisingPublicBlockDto {
  @ApiProperty({enum:['text','image']}) type!: 'text'|'image'
  @ApiPropertyOptional() text?: string
  @ApiPropertyOptional() imageUrl?: string
}
export class AdvertisingPublicIntroductionDto {
  @ApiProperty() id!: string
  @ApiProperty() name!: string
  @ApiProperty() companyName!: string
  @ApiProperty() contactName!: string
  @ApiProperty() phone!: string
  @ApiProperty() wechatId!: string
  @ApiProperty() summary!: string
  @ApiProperty({type:String,nullable:true}) coverImageUrl!: string|null
  @ApiProperty({type:[AdvertisingPublicBlockDto]}) blocks!: AdvertisingPublicBlockDto[]
}
export class AdvertisingPublicBackgroundDto { @ApiProperty({type:String,nullable:true}) imageUrl!: string|null }
