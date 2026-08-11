# Chronos Fútbol - Reglas del Proyecto

## Comandos de Desarrollo
- Desarrollo local: `npm run dev`
- Despliegue a Testeo (OBLIGATORIO para pruebas): `npm run deploy:staging`
- Despliegue a Producción: `npm run deploy:prod`

## Reglas de Trabajo con IA
1. Trabaja siempre en el código fuente actual dentro de esta misma carpeta.
2. Tras realizar modificaciones o solucionar bugs, ejecuta automáticamente `npm run deploy:staging` para subir los cambios a testeo (`cronos-futbol-test.web.app`).
3. NUNCA ejecutes `npm run deploy:prod` ni despliegues a `cronos-futbol-app` salvo que el usuario lo solicite expresamente tras haber probado en staging.
4. Despliega solo los servicios de Hosting y Firestore rules (`--only hosting,firestore`) para mantener el proyecto de staging libre de costes.