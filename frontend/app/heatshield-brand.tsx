import Image from 'next/image';

export default function HeatShieldBrand() {
  return <span className="heatshield-lockup">
    <Image className="heatshield-mark" src="/heatshield-mark.svg" width={42} height={42} alt=""/>
    <span className="heatshield-wordmark">Heat<span>Shield</span></span>
  </span>;
}
