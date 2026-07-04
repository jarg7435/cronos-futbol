{
  "name": "chronos-futbol",
  "version": "1.0.0",
  "description": "CHRONOS FÚTBOL — Control de tiempos de juego para fútbol base",
  "private": true,
  "scripts": {
    "dev": "firebase serve --only hosting,functions",
    "build": "echo 'TODO: configurar Vite en Fase 2' && exit 0",
    "lint": "eslint js/ functions/ --ext .js",
    "lint:fix": "eslint js/ functions/ --ext .js --fix",
    "format": "prettier --write \"js/**/*.js\" \"functions/**/*.js\" \"*.json\" \"*.html\"",
    "format:check": "prettier --check \"js/**/*.js\" \"functions/**/*.js\"",
    "test": "echo 'TODO: configurar Vitest en Fase 4' && exit 0",
    "deploy:staging": "firebase deploy --project cronos-futbol-staging",
    "deploy:prod": "firebase deploy --project cronos-futbol-app",
    "deploy:hosting": "firebase deploy --only hosting",
    "deploy:functions": "firebase deploy --only functions",
    "deploy:rules": "firebase deploy --only firestore:rules",
    "clean": "rm -rf dist/ .firebase/ functions/node_modules/",
    "fresh": "npm run clean && npm install && cd functions && npm install"
  },
  "dependencies": {
    "firebase-admin": "^13.10.0"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "prettier": "^3.2.0",
    "@eslint/js": "^9.0.0",
    "firebase-tools": "^13.0.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.2.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}