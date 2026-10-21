// Architecture/dev icon set. Each icon draws line-art in a 24x24 unit box.
// drawIcon() scales that box to the element's world size. Stroke uses the
// element color; a couple of icons add a subtle fill.

import { getImage } from "./imageCache";
import { isSvgIcon, svgIconDataUri } from "./svgIcons";

/** id prefix for official AWS service icons, e.g. "aws-svc:ec2". */
export const AWS_SVC_PREFIX = "aws-svc:";
/** id prefix for dev-ecosystem tool icons, e.g. "dev:redis". */
export const DEV_PREFIX = "dev:";

type IconFn = (ctx: CanvasRenderingContext2D) => void;

// helpers operate in the 24x24 space
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.stroke();
}

export const ICONS: Record<string, IconFn> = {
  database: (ctx) => {
    ctx.beginPath();
    ctx.ellipse(12, 5.5, 7, 2.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, 5.5);
    ctx.lineTo(5, 18.5);
    ctx.moveTo(19, 5.5);
    ctx.lineTo(19, 18.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(12, 18.5, 7, 2.6, 0, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(12, 12, 7, 2.6, 0, 0, Math.PI);
    ctx.stroke();
  },
  server: (ctx) => {
    rr(ctx, 4, 4, 16, 6.5, 1.5);
    rr(ctx, 4, 13.5, 16, 6.5, 1.5);
    ctx.beginPath();
    ctx.moveTo(7, 7.2);
    ctx.lineTo(7, 7.2);
    ctx.arc(7, 7.2, 0.4, 0, Math.PI * 2);
    ctx.moveTo(7, 16.7);
    ctx.arc(7, 16.7, 0.4, 0, Math.PI * 2);
    ctx.stroke();
  },
  cloud: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(7, 17);
    ctx.arc(8.5, 13.5, 3.5, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(13, 10.5, 4, Math.PI, Math.PI * 1.9);
    ctx.arc(17, 14, 3, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
    ctx.stroke();
  },
  user: (ctx) => {
    ctx.beginPath();
    ctx.arc(12, 8.5, 3.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, 20);
    ctx.arc(12, 20, 7, Math.PI, Math.PI * 2);
    ctx.stroke();
  },
  api: (ctx) => {
    ctx.beginPath();
    ctx.arc(12, 12, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(12, 12, 3.4, 8, 0, 0, Math.PI * 2);
    ctx.moveTo(4, 12);
    ctx.lineTo(20, 12);
    ctx.moveTo(5.5, 7.5);
    ctx.lineTo(18.5, 7.5);
    ctx.moveTo(5.5, 16.5);
    ctx.lineTo(18.5, 16.5);
    ctx.stroke();
  },
  queue: (ctx) => {
    rr(ctx, 3.5, 8, 4.5, 8, 1);
    rr(ctx, 9.75, 8, 4.5, 8, 1);
    rr(ctx, 16, 8, 4.5, 8, 1);
  },
  cache: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(13, 3);
    ctx.lineTo(6, 13);
    ctx.lineTo(11, 13);
    ctx.lineTo(10, 21);
    ctx.lineTo(18, 10);
    ctx.lineTo(12.5, 10);
    ctx.closePath();
    ctx.stroke();
  },
  browser: (ctx) => {
    rr(ctx, 3.5, 4.5, 17, 15, 2);
    ctx.beginPath();
    ctx.moveTo(3.5, 9);
    ctx.lineTo(20.5, 9);
    ctx.moveTo(6.2, 6.8);
    ctx.arc(6.2, 6.8, 0.3, 0, Math.PI * 2);
    ctx.moveTo(8.2, 6.8);
    ctx.arc(8.2, 6.8, 0.3, 0, Math.PI * 2);
    ctx.stroke();
  },
  mobile: (ctx) => {
    rr(ctx, 7, 3, 10, 18, 2.5);
    ctx.beginPath();
    ctx.moveTo(10.5, 18);
    ctx.lineTo(13.5, 18);
    ctx.stroke();
  },
  gear: (ctx) => {
    ctx.beginPath();
    ctx.arc(12, 12, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(12 + c * 5, 12 + s * 5);
      ctx.lineTo(12 + c * 7.5, 12 + s * 7.5);
    }
    ctx.stroke();
  },
  lambda: (ctx) => {
    rr(ctx, 3.5, 3.5, 17, 17, 3);
    ctx.beginPath();
    ctx.moveTo(8, 6.5);
    ctx.lineTo(11, 6.5);
    ctx.lineTo(16, 17.5);
    ctx.moveTo(13.5, 11.5);
    ctx.lineTo(8, 17.5);
    ctx.stroke();
  },
  folder: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(4, 7);
    ctx.lineTo(9, 7);
    ctx.lineTo(11, 9.5);
    ctx.lineTo(20, 9.5);
    ctx.lineTo(20, 18);
    ctx.lineTo(4, 18);
    ctx.closePath();
    ctx.stroke();
  },
};

export const ICON_IDS = Object.keys(ICONS);

// AWS-style service icons: a category-colored rounded square with a white glyph
// (my own simplified renditions — not the official AWS asset set).
interface AwsIcon {
  bg: string;
  glyph: IconFn;
}
const O = "#ED7100"; // compute
const G = "#7AA116"; // storage
const B = "#3334B9"; // database
const P = "#8C4FFF"; // networking
const K = "#E7157B"; // app integration / management
const R = "#DD344C"; // security

function cyl(ctx: CanvasRenderingContext2D, extraBand: boolean): void {
  ctx.beginPath();
  ctx.ellipse(12, 7, 6, 2.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6, 7);
  ctx.lineTo(6, 17);
  ctx.moveTo(18, 7);
  ctx.lineTo(18, 17);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(12, 17, 6, 2.2, 0, 0, Math.PI);
  if (extraBand) ctx.ellipse(12, 12, 6, 2.2, 0, 0, Math.PI);
  ctx.stroke();
}

export const AWS_ICONS: Record<string, AwsIcon> = {
  "aws-ec2": {
    bg: O,
    glyph: (c) => {
      c.strokeRect(6.5, 6.5, 11, 11);
      c.strokeRect(9.5, 9.5, 5, 5);
      c.beginPath();
      for (const v of [9, 12, 15]) {
        c.moveTo(v, 4.5); c.lineTo(v, 6.5); c.moveTo(v, 17.5); c.lineTo(v, 19.5);
        c.moveTo(4.5, v); c.lineTo(6.5, v); c.moveTo(17.5, v); c.lineTo(19.5, v);
      }
      c.stroke();
    },
  },
  "aws-lambda": {
    bg: O,
    glyph: (c) => {
      c.beginPath();
      c.moveTo(7, 5); c.lineTo(10.5, 5); c.lineTo(17.5, 19);
      c.moveTo(14, 11.5); c.lineTo(8, 19);
      c.stroke();
    },
  },
  "aws-ecs": {
    bg: O,
    glyph: (c) => {
      c.strokeRect(5, 5, 6, 6);
      c.strokeRect(13, 5, 6, 6);
      c.strokeRect(5, 13, 6, 6);
      c.strokeRect(13, 13, 6, 6);
    },
  },
  "aws-s3": {
    bg: G,
    glyph: (c) => {
      c.beginPath();
      c.moveTo(5, 6.5); c.lineTo(19, 6.5); c.lineTo(17, 19); c.lineTo(7, 19); c.closePath();
      c.stroke();
      c.beginPath();
      c.moveTo(5, 6.5); c.bezierCurveTo(5, 4.5, 19, 4.5, 19, 6.5);
      c.stroke();
    },
  },
  "aws-rds": { bg: B, glyph: (c) => cyl(c, false) },
  "aws-dynamodb": { bg: B, glyph: (c) => cyl(c, true) },
  "aws-apigateway": {
    bg: P,
    glyph: (c) => {
      c.beginPath();
      c.moveTo(10, 5); c.quadraticCurveTo(6, 5, 6, 9.5); c.quadraticCurveTo(6, 12, 4, 12);
      c.quadraticCurveTo(6, 12, 6, 14.5); c.quadraticCurveTo(6, 19, 10, 19);
      c.moveTo(14, 5); c.quadraticCurveTo(18, 5, 18, 9.5); c.quadraticCurveTo(18, 12, 20, 12);
      c.quadraticCurveTo(18, 12, 18, 14.5); c.quadraticCurveTo(18, 19, 14, 19);
      c.stroke();
    },
  },
  "aws-cloudfront": {
    bg: P,
    glyph: (c) => {
      c.beginPath();
      c.arc(12, 12, 7, 0, Math.PI * 2);
      c.moveTo(5, 12); c.lineTo(19, 12);
      c.stroke();
      c.beginPath();
      c.ellipse(12, 12, 3, 7, 0, 0, Math.PI * 2);
      c.stroke();
    },
  },
  "aws-vpc": {
    bg: P,
    glyph: (c) => {
      c.setLineDash([2.5, 2]);
      c.beginPath();
      if (c.roundRect) c.roundRect(4, 4, 16, 16, 3);
      else c.rect(4, 4, 16, 16);
      c.stroke();
      c.setLineDash([]);
    },
  },
  "aws-elb": {
    bg: P,
    glyph: (c) => {
      c.beginPath();
      c.arc(6, 12, 2, 0, Math.PI * 2);
      c.arc(18, 6.5, 2, 0, Math.PI * 2);
      c.arc(18, 17.5, 2, 0, Math.PI * 2);
      c.moveTo(8, 12); c.lineTo(16, 6.5);
      c.moveTo(8, 12); c.lineTo(16, 17.5);
      c.stroke();
    },
  },
  "aws-sqs": {
    bg: K,
    glyph: (c) => {
      for (const x of [6, 10.5, 15]) c.strokeRect(x, 7, 3.2, 10);
    },
  },
  "aws-sns": {
    bg: K,
    glyph: (c) => {
      c.beginPath();
      c.arc(7.5, 12, 2.4, 0, Math.PI * 2);
      c.arc(17, 6.5, 1.9, 0, Math.PI * 2);
      c.arc(19, 12, 1.9, 0, Math.PI * 2);
      c.arc(17, 17.5, 1.9, 0, Math.PI * 2);
      c.moveTo(10, 11); c.lineTo(15, 7);
      c.moveTo(10, 12); c.lineTo(17, 12);
      c.moveTo(10, 13); c.lineTo(15, 17);
      c.stroke();
    },
  },
  "aws-iam": {
    bg: R,
    glyph: (c) => {
      c.beginPath();
      c.arc(9, 9, 3.6, 0, Math.PI * 2);
      c.moveTo(11.2, 11.2); c.lineTo(19, 19);
      c.moveTo(15.5, 15.5); c.lineTo(17.5, 13.5);
      c.stroke();
    },
  },
  "aws-cloudwatch": {
    bg: K,
    glyph: (c) => {
      c.beginPath();
      c.arc(12, 12, 7, 0, Math.PI * 2);
      c.moveTo(12, 12); c.lineTo(12, 7.5);
      c.moveTo(12, 12); c.lineTo(15.5, 14);
      c.stroke();
    },
  },
};

export const AWS_ICON_IDS = Object.keys(AWS_ICONS);

export const ICON_LABELS: Record<string, string> = {
  database: "Database",
  server: "Server",
  cloud: "Cloud",
  user: "User",
  api: "API",
  queue: "Queue",
  cache: "Cache",
  browser: "Browser",
  mobile: "Mobile",
  gear: "Config",
  lambda: "Function",
  folder: "Folder",
  "aws-ec2": "EC2",
  "aws-lambda": "Lambda",
  "aws-ecs": "ECS",
  "aws-s3": "S3",
  "aws-rds": "RDS",
  "aws-dynamodb": "DynamoDB",
  "aws-apigateway": "API Gateway",
  "aws-cloudfront": "CloudFront",
  "aws-vpc": "VPC",
  "aws-elb": "ELB",
  "aws-sqs": "SQS",
  "aws-sns": "SNS",
  "aws-iam": "IAM",
  "aws-cloudwatch": "CloudWatch",
};

/** Draw an icon element's art into its world-space box. */
export function drawIconArt(
  ctx: CanvasRenderingContext2D,
  iconId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  opacity: number,
): void {
  // SVG-library icon (AWS official / dev tools): draw the cached SVG bitmap, or
  // a placeholder rounded square while its data chunk / image is still loading.
  if (isSvgIcon(iconId)) {
    const uri = svgIconDataUri(iconId);
    const img = uri ? getImage(uri) : null;
    ctx.save();
    ctx.globalAlpha = opacity;
    if (img) {
      ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = "rgba(127,127,127,0.18)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, w * 0.12);
      else ctx.rect(x, y, w, h);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  const aws = AWS_ICONS[iconId];
  if (aws) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(x, y);
    ctx.scale(w / 24, h / 24);
    ctx.fillStyle = aws.bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0.5, 0.5, 23, 23, 4);
    else ctx.rect(0.5, 0.5, 23, 23);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1.7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    aws.glyph(ctx);
    ctx.restore();
    return;
  }
  const fn = ICONS[iconId];
  if (!fn) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.scale(w / 24, h / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  fn(ctx);
  ctx.restore();
}
