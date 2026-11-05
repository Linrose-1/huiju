<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage } from '../../services/admin'
import { acceptBrand, brandApi } from '../../services/brand'
import { useRequestScope } from '../../services/request-scope'

const form = reactive({ displayName: '', visible: true, version: 0 })
const loading = ref(false), saving = ref(false), loaded = ref(false), error = ref('')
const beginLoad = useRequestScope(), beginSave = useRequestScope()
async function load() {
  if (loading.value || saving.value) return
  const current = beginLoad()
  loading.value = true
  error.value = ''
  try {
    const result = await brandApi.get()
    if (!current()) return
    Object.assign(form, result)
    acceptBrand(result)
    loaded.value = true
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) loading.value = false }
}
async function save() {
  if (!loaded.value || loading.value || saving.value) return
  const displayName = form.displayName.trim()
  if (!displayName || displayName.length > 30) { error.value = '展示名称须为1至30字。'; return }
  const current = beginSave()
  saving.value = true
  error.value = ''
  try {
    const result = await brandApi.save({ displayName, visible: form.visible, version: form.version })
    if (!current()) return
    Object.assign(form, result)
    acceptBrand(result)
    ElMessage.success('品牌设置已保存')
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) saving.value = false }
}
onMounted(load)
</script>

<template>
  <section>
    <h1>品牌设置</h1>
    <p class="page-description">
      设置后台及小程序活动首页、“我的”页的品牌标识。
    </p>
    <el-alert
      v-if="error"
      class="form-error"
      :title="error"
      type="error"
      :closable="false"
    />
    <div
      v-loading="loading"
      class="panel brand-settings"
    >
      <el-form
        label-position="top"
        @submit.prevent="save"
      >
        <el-form-item label="展示名称">
          <el-input
            v-model="form.displayName"
            :maxlength="30"
            show-word-limit
            :disabled="!loaded || loading || saving"
          />
        </el-form-item>
        <el-form-item label="展示品牌标识">
          <el-switch
            v-model="form.visible"
            :disabled="!loaded || loading || saving"
          />
        </el-form-item>
        <div class="brand-preview">
          <span class="muted">展示预览</span>
          <strong v-if="form.visible">{{ form.displayName.trim() || '请填写展示名称' }}</strong>
          <span
            v-else
            class="muted"
          >品牌标识已隐藏</span>
        </div>
        <p class="muted">
          不改变微信平台登记名称、Logo、导航名称或已发布内容。保存后，小程序重新进入对应页面时更新。
        </p>
        <div class="actions">
          <el-button
            type="primary"
            native-type="submit"
            :loading="saving"
            :disabled="!loaded || loading"
          >
            保存设置
          </el-button>
          <el-button
            :disabled="loading || saving"
            @click="load"
          >
            {{ loaded ? '重新读取' : '重试加载' }}
          </el-button>
        </div>
      </el-form>
    </div>
  </section>
</template>

<style scoped>
.brand-settings { max-width: 640px; }
.brand-preview { display: flex; align-items: center; gap: 20px; padding: 18px; border-radius: 8px; background: #f5f7f5; overflow-wrap: anywhere; }
.brand-preview strong { font-size: 20px; color: var(--huiju-green); }
</style>
