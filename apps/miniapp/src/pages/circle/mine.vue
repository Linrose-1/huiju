<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow, onHide, onUnload, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { CirclePost } from '@/services/api/types'
import { useSessionStore } from '@/stores/session'
import { bootstrapIdentity } from '@/services/wechat'
import { routes, navigate, loginPage } from '@/services/navigation'
import { useCircleList, categoryLabel, subtypeLabel, stateLabel, circleTime, circleImagePreview } from '@/services/circle'
import RequestState from '@/components/base/RequestState.vue'
import ListMore from '@/components/base/ListMore.vue'
const session = useSessionStore(), actionError = ref(''), ending = ref(''), preparing = ref(false)
type OwnerCard = CirclePost & {thumbnail: string; thumbnailError: boolean}
const list = useCircleList<OwnerCard>(async offset => {
  const page = await api.circlePosts({ offset }, true)
  const items = await Promise.all(page.items.map(async post => {
    try { return {...post, thumbnail: post.images[0] ? await circleImagePreview(post.images[0].url,post.state==='removed') : '', thumbnailError:false} }
    catch { return {...post,thumbnail:'',thumbnailError:true} }
  }))
  return {...page,items}
})
const { items, loading, loadingMore, error, moreError, hasMore } = list
let generation = 0, visible = false
async function load() { const current=++generation; preparing.value=true; try { await bootstrapIdentity(); if(current===generation) await list.load() } catch(e) { if(current!==generation)return; error.value=errorMessage(e); if(!session.token)loginPage(routes.circleMine) } finally { if(current===generation)preparing.value=false;uni.stopPullDownRefresh() } }
async function end(post: CirclePost) {
  if(ending.value)return
  const token=session.token, epoch=session.epoch, current=generation
  ending.value=post.id; actionError.value=''
  try {
    const confirm=await new Promise<boolean>(yes=>uni.showModal({title:'标记已结束',content:'结束后不再接收新意向，帖子内容和历史意向保留。',success:r=>yes(r.confirm),fail:()=>yes(false)}))
    if(!confirm || token!==session.token || epoch!==session.epoch || current!==generation)return
    await api.endCirclePost(post.id)
    if(token===session.token && epoch===session.epoch && current===generation)await list.load()
  } catch(e) { if(current===generation && token===session.token)actionError.value=errorMessage(e) }
  finally { if(current===generation)ending.value='' }
}
function clear(){generation++;list.clear();ending.value='';actionError.value='';preparing.value=false}
watch(() => [session.token, session.epoch], async () => {
  clear(); const current=generation
  await Promise.resolve()
  if(visible && current===generation)void load()
}, {flush:'sync'})
onShow(()=>{visible=true;void load()});onHide(()=>{visible=false;clear()});onUnload(()=>{visible=false;clear()});onReachBottom(()=>list.load(true));onPullDownRefresh(load)
</script>
<template>
  <view class="circle-page">
    <RequestState
      :loading="preparing || loading"
      :error="error"
      :empty="!items.length"
      empty-text="你还没有发布帖子"
      @retry="load"
    />
    <view
      v-if="actionError"
      class="error circle-error"
    >
      {{ actionError }}
    </view>
    <view
      v-for="post in items"
      :key="post.id"
      class="circle-card"
    >
      <view
        class="row"
        @click="navigate(routes.circleDetail+'?id='+post.id)"
      >
        <image
          v-if="post.thumbnail"
          class="circle-photo"
          :src="post.thumbnail"
          mode="aspectFill"
        /><view class="grow">
          <view class="row between">
            <text class="circle-title">{{ post.title }}</text><text
              class="circle-status"
              :class="post.state"
            >
              {{ stateLabel(post.state) }}
            </text>
          </view><view class="circle-tag mine-tag">{{ categoryLabel(post.category) }}{{ post.subtype?' · '+subtypeLabel(post.subtype):'' }}</view><view
            v-if="post.location"
            class="circle-muted"
          >
            ⌖ {{ post.location }}
          </view><view class="circle-copy mine-summary">{{ post.body }}</view>
        </view>
      </view>
      <view class="circle-muted">{{ circleTime(post.createdAt) }} 发布</view>
      <view
        v-if="post.thumbnailError"
        class="circle-muted"
        @tap="load"
      >
        图片加载失败，点击重试
      </view>
      <view
        v-if="post.state==='removed'"
        class="error circle-error"
      >
        下架原因：{{ post.removalReason || '请联系平台了解详情' }}
      </view>
      <view class="circle-actions">
        <button
          :class="post.state==='open'?'btn-primary':'mine-outline'"
          @click="navigate(routes.circleIntents+'?id='+post.id)"
        >
          查看意向
        </button><button
          v-if="post.state!=='ended'"
          class="mine-outline"
          @click="navigate(routes.circleEditor+'?id='+post.id)"
        >
          编辑
        </button><button
          v-if="post.state==='open'"
          class="circle-gold"
          :disabled="!!ending"
          @click="end(post)"
        >
          {{ ending===post.id?'处理中…':'标记已结束' }}
        </button>
      </view>
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
<style scoped>.mine-tag{margin:16rpx 0}.mine-summary{margin:10rpx 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.circle-status{flex-shrink:0}.circle-photo{height:220rpx;width:200rpx}</style>
<style scoped>.mine-outline{border:2rpx solid #225c43;background:#fff;color:#174b38}.row.between{gap:12rpx}.row.between .circle-title{flex:1;min-width:0;font-size:30rpx}.circle-actions button{font-size:25rpx}.circle-card>.circle-muted{margin-top:16rpx}</style>
