const GitRevisionPlugin = require('git-revision-webpack-plugin');
const gitRevision = new GitRevisionPlugin();
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

// @NOTE: These need to be updated per-project
const COMMIT_HASH = gitRevision.commithash();
const GITHUB_URL = 'https://github.com/themikelester/ts-boilerplate';
const GTAG_ID = 'Some Google Analytics ID';

module.exports = {
  entry: {
    main: './src/main.ts',
    embed: './src/embeds/embeds_main.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-[contentHash].js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      // ts-loader defined in dev and prod separately
      {
        test: /\.(png|woff2)$/,
        loader: 'file-loader',
        options: {
          name: '[name]-[sha1:hash:hex:20].[ext]',
        },
      },
      {
        test: /\.(glsl|vs|fs|vert|frag)$/,
        exclude: /node_modules/,
        use: {
          loader: 'webpack-glsl-minify',
          options: {
            preserveDefines: false,
            preserveUniforms: true,
            preserveVariables: false,
          }
        }
      },
      {
        test: /\.worker\.ts$/,
        loader: 'worker-loader',
        exclude: /node_modules/,
        options: { 
          name: '[name].[hash].js',
        }
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      '__COMMIT_HASH': JSON.stringify(COMMIT_HASH),
      '__GITHUB_URL': JSON.stringify(GITHUB_URL)
    }),
    new webpack.IgnorePlugin({
      // Workaround for broken libraries
      resourceRegExp: /^(fs|path)$/,
    }),
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [
        '**/*',
        '!data',
        '!data/**/*',
        '!.htaccess',
      ],
    }),
    new HtmlWebpackPlugin({
      chunks: ['main'],
      filename: 'index.html',
      template: './src/index.html',
      gtagId: GTAG_ID
    }),
    new HtmlWebpackPlugin({
      chunks: ['embed'],
      filename: 'embed.html',
      template: './src/embed.html',
    }),
  ],
};
