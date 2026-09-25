<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  console.info('会聚小程序启动')
})
</script>

<style lang="scss">
@import '@/uni_modules/uni-scss/index.scss';

/* #ifndef APP-NVUE */
@import '@/static/customicons.css';

page {
  background-color: #f7f8f6;
  color: #16231d;
}
/* #endif */
</style>
