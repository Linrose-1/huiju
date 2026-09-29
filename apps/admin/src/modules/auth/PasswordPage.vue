<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi, errorMessage } from '../../services/admin'
import { router } from '../../router'

const currentPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const error = ref('')
const submitting = ref(false)
let active = true
onBeforeUnmount(() => { active = false; currentPassword.value = ''; newPassword.value = ''; confirmation.value = '' })
async function submit() {
  if (submitting.value) return
  if (!currentPassword.value || newPassword.value.length < 12 || newPassword.value.length > 128 || !/[a-zA-Z]/.test(newPassword.value) || !/[0-9]/.test(newPassword.value)) { error.value = '请填写当前密码，新密码需为 12–128 位，包含字母和数字。'; return }
  if (newPassword.value !== confirmation.value) { error.value = '两次填写的新密码不一致。'; return }
  if (newPassword.value === currentPassword.value) { error.value = '新密码不能与当前密码相同。'; return }
  submitting.value = true
  error.value = ''
  try { await adminApi.password(currentPassword.value, newPassword.value); ElMessage.success('密码已修改，请用新密码重新登录。') }
  catch (value) { if (active) error.value = errorMessage(value) }
  finally { if (active) submitting.value = false }
}
</script>

<template>
  <section class="password-card panel">
    <h1>修改密码</h1>
    <p class="page-description">
      修改成功后，所有设备上的登录将失效。
    </p>
    <el-alert
      v-if="error"
      class="form-error"
      :title="error"
      type="error"
      :closable="false"
    />
    <el-form
      label-position="top"
      @submit.prevent="submit"
    >
      <el-form-item label="当前密码">
        <el-input
          v-model="currentPassword"
          type="password"
          autocomplete="current-password"
          show-password
          :disabled="submitting"
          :maxlength="128"
        />
      </el-form-item>
      <el-form-item label="新密码（12–128 位，包含字母和数字）">
        <el-input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          show-password
          :disabled="submitting"
          :maxlength="128"
        />
      </el-form-item>
      <el-form-item label="再次填写新密码">
        <el-input
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          show-password
          :disabled="submitting"
          :maxlength="128"
        />
      </el-form-item>
      <div class="actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="submitting"
        >
          保存并重新登录
        </el-button>
        <el-button
          :disabled="submitting"
          @click="router.push('/feedback')"
        >
          取消
        </el-button>
      </div>
    </el-form>
  </section>
</template>
