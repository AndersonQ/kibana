/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const AGENT_NAME_DASHBOARD_FILE_MAPPING: Record<string, string> = {
  nodejs: 'nodejs',
  'opentelemetry/nodejs': 'opentelemetry_nodejs',
  java: 'java',
  'opentelemetry/java': 'opentelemetry_java',
  'opentelemetry/java/opentelemetry-java-instrumentation': 'opentelemetry_java',
  'opentelemetry/java/elastic': 'opentelemetry_java',
  'opentelemetry/dotnet': 'opentelemetry_dotnet',
  'opentelemetry/dotnet/opentelemetry-dotnet-instrumentation': 'opentelemetry_dotnet',
  'opentelemetry/dotnet/elastic': 'opentelemetry_dotnet',
};

/**
 * The specially formatted comment in the `import` expression causes the corresponding webpack chunk to be named. This aids us in debugging chunk size issues.
 * See https://webpack.js.org/api/module-methods/#magic-comments
 */
export async function loadDashboardFile(filename: string): Promise<any> {
  switch (filename) {
    case 'nodejs': {
      return import(
        /* webpackChunkName: "lazyNodeJsDashboard" */
        './nodejs.json'
      );
    }
    case 'opentelemetry_nodejs': {
      return import(
        /* webpackChunkName: "lazyNodeJsDashboard" */
        './opentelemetry_nodejs.json'
      );
    }
    case 'java': {
      return import(
        /* webpackChunkName: "lazyJavaDashboard" */
        './java.json'
      );
    }
    case 'opentelemetry_java': {
      return import(
        /* webpackChunkName: "lazyJavaDashboard" */
        './opentelemetry_java.json'
      );
    }
    case 'opentelemetry_dotnet': {
      return import(
        /* webpackChunkName: "lazyOtelDotnetDashboard" */
        './opentelemetry_dotnet.json'
      );
    }
    default: {
      break;
    }
  }
}
