<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad,onShow,onHide,onUnload,onReachBottom,onPullDownRefresh } from '@dcloudio/uni-app'
import { api,errorMessage } from '@/services/api'
import type { CirclePost,CircleIntent } from '@/services/api/types'
import { useSessionStore } from '@/stores/session'
import { bootstrapIdentity } from '@/services/wechat'
import { routes,loginPage } from '@/services/navigation'
import { mediaUrl } from '@/services/api/environment'
import { useCircleList,categoryLabel,subtypeLabel,circleTime,circleImagePreview } from '@/services/circle'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
const id=ref(''),post=ref<CirclePost|null>(null),session=useSessionStore()
const list=useCircleList<CircleIntent>(offset=>api.circleIntents(id.value,offset))
const {items,loading,loadingMore,error,moreError,hasMore}=list
const thumbnail=ref(''), thumbnailError=ref(false), preparing=ref(false)
let generation=0,visible=false
onLoad(o=>{id.value=String(o?.id||'')})
async function load(){
  const current=++generation
  post.value=null;thumbnail.value='';thumbnailError.value=false;list.clear();preparing.value=true
  try{
    if(!id.value)throw new Error('帖子不存在')
    await bootstrapIdentity()
    if(current!==generation)return
    const token=session.token,epoch=session.epoch
    const valid=()=>current===generation&&token===session.token&&epoch===session.epoch
    const data=await api.circlePost(id.value,true)
    if(!valid())return
    post.value=data
    await Promise.all([list.load(),(async()=>{
      if(!data.images[0])return
      try{const image=await circleImagePreview(data.images[0].url,data.state==='removed');if(valid())thumbnail.value=image}
      catch{if(valid())thumbnailError.value=true}
    })()])
  }catch(e){if(current!==generation)return;error.value=errorMessage(e);if(!session.token)loginPage(routes.circleIntents+'?id='+id.value)}
  finally{if(current===generation)preparing.value=false;uni.stopPullDownRefresh()}
}
function clear(){generation++;post.value=null;thumbnail.value='';thumbnailError.value=false;preparing.value=false;list.clear()}
watch(() => [session.token, session.epoch], async () => {
  clear(); const current=generation
  await Promise.resolve()
  if(visible && current===generation)void load()
}, {flush:'sync'})
onShow(()=>{visible=true;void load()});onHide(()=>{visible=false;clear()});onUnload(()=>{visible=false;clear()});onReachBottom(()=>list.load(true));onPullDownRefresh(load)
</script>
<template>
  <view class="circle-page">
    <view
      v-if="post"
      class="circle-card row"
    >
      <image
        v-if="thumbnail"
        class="circle-photo"
        :src="thumbnail"
        mode="aspectFill"
      /><view><view class="circle-title">{{ post.title }}</view><view class="circle-tag">{{ categoryLabel(post.category) }}{{ post.subtype?' · '+subtypeLabel(post.subtype):'' }}</view></view>
    </view>
    <view
      v-if="thumbnailError"
      class="circle-muted"
      @tap="load"
    >
      帖子图片加载失败，点击重试
    </view>
    <view class="circle-intent-privacy">⌕ 联系电话仅发布者可见</view>
    <RequestState
      :loading="preparing || loading"
      :error="error"
      :empty="!items.length"
      empty-text="暂时没有收到意向"
      @retry="load"
    />
    <view
      v-for="intent in items"
      :key="intent.id"
      class="circle-card"
    >
      <view class="circle-author">
        <image
          v-if="intent.member.avatarUrl"
          class="circle-avatar"
          :src="mediaUrl(intent.member.avatarUrl)"
          mode="aspectFill"
        /><view><view class="circle-title">{{ intent.member.displayName || '学友' }}</view><text class="circle-muted">{{ circleTime(intent.createdAt) }}</text></view>
      </view><view class="circle-intent-phone"><text class="circle-muted">联系电话</text><view>{{ intent.phone }}</view></view>
    </view>
    <ListMore
      :loading="loadingMore"
      :error="moreError"
      :has-more="hasMore"
      :has-items="!!items.length"
      @retry="list.retryMore"
    />
  </view>
</template>
<style lang="scss">@import './circle.scss';</style>
<style scoped>.circle-intent-privacy{padding:24rpx;background:#f7f4e9;color:#8c9487;border-radius:18rpx;margin:20rpx 0 26rpx;font-size:28rpx}.circle-intent-phone{border-top:1rpx solid #edf1ec;margin-top:24rpx;padding:24rpx 10rpx 10rpx}.circle-intent-phone view{font-size:40rpx;color:#174b38;margin-top:6rpx}.circle-card .circle-author{margin-top:0}.circle-card .circle-tag{margin-top:14rpx}</style>
<style scoped>.circle-author .circle-avatar{width:104rpx;height:104rpx}.circle-intent-phone{padding-left:100rpx;position:relative}.circle-intent-phone::before{content:'☎';position:absolute;left:0;top:30rpx;color:#174b38;background:#edf6f1;border-radius:50%;width:74rpx;height:74rpx;line-height:74rpx;text-align:center;font-size:42rpx}.circle-intent-privacy{color:#6e847b}</style>
