<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, errorMessage } from '@/services/api'
import type { MyRegistration } from '@/services/api/types'
import { useSessionStore } from '@/stores/session'
import { routes, navigate, loginPage } from '@/services/navigation'
import ActivitySummary from '@/components/business/ActivitySummary.vue'
import RequestState from '@/components/base/RequestState.vue'
const items = ref<MyRegistration[]>([]), loading = ref(false), error = ref(''), session = useSessionStore()
async function load() { if (!session.token)
    return; loading.value = true; error.value = ''; try {
    items.value = (await api.registrations()).items
}
catch (e) {
    error.value = errorMessage(e)
}
finally {
    loading.value = false
} }
function browse() { uni.switchTab({ url: routes.activity }); }
onShow(load)
</script>
<template>
  <view class="page-pad">
    <view
      v-if="!session.token"
      class="empty"
    >
      登录后查看自己的报名<button
        class="primary"
        @click="loginPage(routes.registrations)"
      >
        微信登录
      </button>
    </view><template v-else>
      <RequestState
        :loading="loading"
        :error="error"
        :empty="!items.length"
        empty-text="还没有报名记录，去发现感兴趣的活动吧"
        @retry="load"
      /><view v-if="!loading && !error">
        <view
          v-for="item in items"
          :key="item.id"
          class="registration"
          @click="navigate(routes.result+'?id='+item.activityId)"
        >
          <view class="registration-state">
            {{ item.status==='active'?'已报名':'已取消' }} <uni-icons
              type="arrow-right"
              size="16"
            />
          </view><ActivitySummary :activity="item.activity" />
        </view><button
          v-if="!items.length"
          class="primary"
          @click="browse"
        >
          去看活动
        </button>
      </view>
    </template>
  </view>
</template>
<style scoped>.registration{position:relative;background:#fff;border-radius:20rpx;margin-bottom:18rpx;padding-top:12rpx}.registration-state{text-align:right;color:#2a6d51;font-size:23rpx;padding:8rpx 25rpx}.empty .primary{margin-top:22rpx}</style>
