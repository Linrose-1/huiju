export const calendarReminders = [
  { label: '不提醒', seconds: null },
  { label: '活动开始时', seconds: 0 },
  { label: '提前 15 分钟', seconds: 900 },
  { label: '提前 30 分钟', seconds: 1800 },
  { label: '提前 1 小时', seconds: 3600 },
  { label: '提前 1 天', seconds: 86400 },
]
export const defaultReminderIndex = 4

export function addActivityCalendar(activity: { title: string; startsAt: string; endsAt: string; location: string }, index: number): Promise<boolean> {
  const startTime = Math.floor(Date.parse(activity.startsAt) / 1000)
  const endTime = Math.floor(Date.parse(activity.endsAt) / 1000)
  const reminder = calendarReminders[index]
  if (!reminder || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return Promise.reject(new Error('活动时间无效，暂时无法添加日历'))
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    if (typeof uni.addPhoneCalendar !== 'function' || !uni.canIUse('addPhoneCalendar')) {
      reject(new Error('当前微信版本或设备不支持添加日历，请升级微信后在手机中重试')); return
    }
    uni.addPhoneCalendar({ title: activity.title, startTime, endTime: String(endTime), location: activity.location,
      alarm: reminder.seconds !== null, alarmOffset: reminder.seconds ?? 0,
      success: () => resolve(true),
      fail: result => {
        if (/cancel/i.test(result.errMsg || '')) { resolve(false); return }
        reject(new Error('未能添加日历，请检查微信及手机的日历权限后重试'))
      } })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序中添加手机日历'))
    // #endif
  })
}

export function openActivityLocation(activity: { location: string; locationLatitude?: number | null; locationLongitude?: number | null }): Promise<void> {
  const { locationLatitude: latitude, locationLongitude: longitude } = activity
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return Promise.reject(new Error('活动尚未设置地图位置，请联系发起人补充；可长按复制地址'))
  }
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.openLocation({ latitude, longitude, name: activity.location, address: activity.location,
      success: () => resolve(), fail: result => /cancel/i.test(result.errMsg || '') ? resolve() : reject(new Error('地图打开失败，请稍后重试')) })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序中打开地图'))
    // #endif
  })
}
