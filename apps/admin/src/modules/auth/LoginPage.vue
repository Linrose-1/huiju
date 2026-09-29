<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { adminApi, errorMessage } from '../../services/admin'

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)
let active = true
onBeforeUnmount(() => { active = false; password.value = '' })
async function submit() {
  if (submitting.value) return
  if (!username.value.trim() || !password.value) { error.value = '请填写账号和密码。'; return }
  submitting.value = true
  error.value = ''
  try { await adminApi.login(username.value.trim(), password.value) }
  catch (value) { if (active) error.value = errorMessage(value) }
  finally { if (active) { submitting.value = false; password.value = '' } }
}
</script>

<template>
  <section class="auth-card panel">
    <div class="brand">
      会聚 <span>管理后台</span>
    </div>
    <h1 style="margin-top: 32px">
      欢迎登录
    </h1>
    <p class="page-description">
      使用管理员为你开通的账号。
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
      <el-form-item label="账号">
        <el-input
          v-model="username"
          autocomplete="username"
          :maxlength="64"
          :disabled="submitting"
        />
      </el-form-item>
      <el-form-item label="密码">
        <el-input
          v-model="password"
          type="password"
          autocomplete="current-password"
          show-password
          :maxlength="128"
          :disabled="submitting"
        />
      </el-form-item>
      <el-button
        class="full-width"
        type="primary"
        native-type="submit"
        :loading="submitting"
      >
        登录
      </el-button>
    </el-form>
    <p class="muted">
      忘记密码？请联系超级管理员；超级管理员请联系部署维护人员。
    </p>
  </section>
</template>
