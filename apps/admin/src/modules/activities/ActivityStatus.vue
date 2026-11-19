<script setup lang="ts">
import type { AdminActivity } from '../../services/admin'
defineProps<{ activity: Pick<AdminActivity, 'moderation' | 'lifecycle'> }>()
</script>

<template>
  <div class="activity-status">
    <el-tag :type="activity.moderation === 'removed' ? 'danger' : 'success'">
      {{ activity.moderation === 'removed' ? '已下架' : '正常展示' }}
    </el-tag>
    <el-tag
      v-if="activity.lifecycle === 'cancelled'"
      type="warning"
    >
      发起人已取消
    </el-tag>
  </div>
</template>
