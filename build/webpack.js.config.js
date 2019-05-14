const TerserWebpackPlugin = require('terser-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const {
  approot,
  defaultArgv,
  generateBaseConfig,
  generateStyleLoader,
  generateFileLoaderForImages,
  generateUrlLoaderForImages,
  generateFileLoaderForOtherAssets,
} = require('./shared')

module.exports = (env, { mode } = defaultArgv) => ({
  name: 'js',

  entry: {
    'background-content-page': approot('src/entries/background-content-page.js'),
    'settings': approot('src/entries/settings.js'),
  },

  output: {
    path: approot('dist'),
    filename: '[name].js',
  },

  ...generateBaseConfig(mode),

  module: {
    rules: [
      { test: /\.js$/, use: [ 'cache-loader', 'babel-loader' ] },
      generateStyleLoader({ mode }),
      generateUrlLoaderForImages(),
      generateFileLoaderForImages({ publicPath: '/' }),
      generateFileLoaderForOtherAssets(),
    ],
  },

  plugins: [
    new MiniCssExtractPlugin(),
    new CopyWebpackPlugin([ {
      from: approot('static'),
      to: approot('dist'),
    } ]),
  ],

  optimization: {
    // 使代码保持在可读的状态，方便用户反馈 bug 后 debug
    minimizer: [
      new TerserWebpackPlugin({
        terserOptions: {
          ecma: 8,
          compress: {
            defaults: false,
            dead_code: true, // eslint-disable-line camelcase
            evaluate: true,
            unused: true,
          },
          mangle: false,
          output: {
            beautify: true,
            indent_level: 2, // eslint-disable-line camelcase
          },
        },
        parallel: true,
      }),
    ],
  },
})
