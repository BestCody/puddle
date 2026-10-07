export async function installStagingSiteProxy(context, { site, app }) {
  const publicHost = new URL(site).host
  await context.route(`${site}/**`, async (route) => {
    try {
      const requestUrl = new URL(route.request().url())
      const response = await route.fetch({
        url: `${app}${requestUrl.pathname}${requestUrl.search}`,
        headers: {
          ...route.request().headers(),
          host: publicHost,
          'x-forwarded-host': publicHost,
          'x-forwarded-proto': 'https'
        },
        maxRedirects: 0,
        timeout: 15_000
      })
      await route.fulfill({ response })
    } catch {
      await route.abort().catch(() => {})
    }
  })
}
