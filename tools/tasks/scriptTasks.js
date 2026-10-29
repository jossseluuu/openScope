/* eslint-disable */

module.exports = function(gulp, config, argv) {
    const path = require('path');
    const browserify = require('browserify');
    const babelify = require('babelify');
    const source = require('vinyl-source-stream');
    const buffer = require('vinyl-buffer');
    const sourcemaps = require('gulp-sourcemaps');
    const gulpif = require('gulp-if');
    const uglify = require('gulp-uglify');
    const rename = require('gulp-rename');
    const OPTIONS = config;

    const bundle = (entry, name) => {
        const b = browserify({
            entries: entry,
            extensions: ['.js'],
            debug: true,
            transform: [babelify]
        });

        return b.bundle()
            .pipe(source(name))
            .pipe(buffer())
            .pipe(sourcemaps.init({ loadMaps: true }))
            .pipe(gulpif(
                argv.prod,
                uglify({ mangle: false })
            ))
            .pipe(rename({ suffix: '.min' }))
            .pipe(sourcemaps.write('./'))
            .pipe(gulp.dest(OPTIONS.DIR.DIST_SCRIPTS_CLIENT));
    };

    // the game, and the bot audit page (/bot-audit)
    const buildGame = () => bundle(OPTIONS.FILE.JS_ENTRY_CLIENT, 'bundle.js');
    const buildAuditPage = () => bundle(OPTIONS.FILE.JS_ENTRY_AUDIT_PAGE, 'auditPage.js');
    const buildScripts = gulp.parallel(buildGame, buildAuditPage);

    const buildServer = () => gulp.src('**/*.js', {cwd: OPTIONS.DIR.SRC_SCRIPTS_SERVER})
        .pipe(gulp.dest(OPTIONS.DIR.DIST_SCRIPTS_SERVER));

    gulp.task(OPTIONS.TASKS.BUILD.SCRIPTS, gulp.series(buildScripts));
    gulp.task(OPTIONS.TASKS.BUILD.SERVER, gulp.series(buildServer));
    gulp.task(OPTIONS.TASKS.WATCH.SCRIPTS, () => {
        gulp.watch(OPTIONS.GLOB.JS).on('change', () => buildScripts(() => {}));
    });
};
