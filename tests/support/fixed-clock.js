// Preload (node --require) yang membekukan "sekarang" pada waktu dari FIXED_NOW (ISO) tanpa menghentikan timer.
const RealDate = Date;
const fixed = RealDate.parse(process.env.FIXED_NOW);
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(fixed);
    else super(...args);
  }
  static now() { return fixed; }
}
global.Date = FixedDate;
