export function createStarField() {
    const container = document.getElementById('starsBackground');
    const starCount = 100;
    const lineCount = 15;
    const shootingStarCount = 3;

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDelay = Math.random() * 3 + 's';
        star.style.opacity = 0.3 + Math.random() * 0.5;
        container.appendChild(star);
    }

    const stars = container.querySelectorAll('.star');
    for (let i = 0; i < lineCount; i++) {
        const star1 = stars[Math.floor(Math.random() * stars.length)];
        const star2 = stars[Math.floor(Math.random() * stars.length)];
        
        if (star1 !== star2) {
            const x1 = parseFloat(star1.style.left);
            const y1 = parseFloat(star1.style.top);
            const x2 = parseFloat(star2.style.left);
            const y2 = parseFloat(star2.style.top);
            
            const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            
            if (distance < 20) {
                const line = document.createElement('div');
                line.className = 'constellation-line';
                line.style.left = x1 + '%';
                line.style.top = y1 + '%';
                line.style.width = distance + '%';
                
                const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                line.style.transform = `rotate(${angle}deg)`;
                
                container.appendChild(line);
            }
        }
    }

    for (let i = 0; i < shootingStarCount; i++) {
        const shootingStar = document.createElement('div');
        shootingStar.className = 'shooting-star';
        shootingStar.style.left = Math.random() * 80 + '%';
        shootingStar.style.top = Math.random() * 50 + '%';
        shootingStar.style.animationDelay = Math.random() * 10 + 's';
        shootingStar.style.animationDuration = (2 + Math.random() * 2) + 's';
        container.appendChild(shootingStar);
    }
}
