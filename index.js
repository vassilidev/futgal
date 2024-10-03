import puppeteer from "puppeteer";
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';

(async () => {
    console.log('Démarrage du script d\'extraction des données des clubs...');

    // Fichier pour sauvegarder l'avancement du scraping
    const progressFile = './scraping_progress.json';
    // Fichier pour sauvegarder les données extraites
    const outputPath = './clubs.json';

    try {
        // Chargement de l'état du scraping si disponible
        let processedLinks = [];
        if (existsSync(progressFile)) {
            processedLinks = JSON.parse(readFileSync(progressFile));
            console.log(`Reprise du scraping. ${processedLinks.length} liens déjà traités.`);
        }

        // Lancement du navigateur Puppeteer en mode headless
        console.log('Lancement du navigateur Puppeteer...');
        const browser = await puppeteer.launch({ headless: true, ignoreHTTPSErrors: true });
        const page = await browser.newPage();

        console.log('Navigateur lancé avec succès.');

        // Navigation vers la page cible pour extraire les liens des clubs
        const targetURL = 'https://www.futgal.es/pnfg/NPcd/NFG_Clubes?cod_primaria=1000118&NPcd_Page=1&nueva_ventana=&Buscar=1&orden=12&cod_club=&nclub=&Sch_CodCategoria=&cod_provincia=&localidad_txt=--+Seleccione+Provincia+--&localidad=0&code_delegacion=&cod_delegacion=&cod_postal=&NPcd_PageLines=2000';

        console.log(`Navigation vers l'URL cible: ${targetURL}`);

        await page.goto(targetURL, { waitUntil: ['domcontentloaded'] });

        console.log('Page chargée avec succès.');

        // Extraction des liens de clubs
        console.log('Extraction des liens des clubs...');

        let clubLinks = await extractClubLinks(page);

        console.log(`Nombre de liens de clubs extraits: ${clubLinks.length}`);

        let parsedClubs = [];

        // Traitement de chaque club pour extraire ses données
        for (let i = 0; i < clubLinks.length; i++) {
            let link = clubLinks[i];

            // Si le lien a déjà été traité, on le saute
            if (processedLinks.includes(link)) {
                console.log(`Lien déjà traité : ${link}. Passage au suivant.`);
                continue;
            }

            console.log(`Traitement du club ${i + 1}/${clubLinks.length}: ${link}`);

            try {
                let clubData = await extractClubData(page, link);
                parsedClubs.push(...clubData);

                console.log(`Données extraites pour le club ${i + 1}.`);

                // Sauvegarde incrémentale après chaque club
                appendFileSync(outputPath, JSON.stringify(clubData, null, 2) + ',\n');

                // Ajout du lien au fichier de progression
                processedLinks.push(link);
                writeFileSync(progressFile, JSON.stringify(processedLinks, null, 2));

            } catch (err) {
                console.error(`Erreur lors de l'extraction des données pour le club ${link}:`, err);

                // Vérification si redirection vers page de login
                if (page.url().includes('login')) {
                    console.error('Redirection détectée vers la page de login. Arrêt du script.');
                    break;
                }
            }
        }

        // Fermeture du navigateur
        await browser.close();

        console.log('Navigateur fermé.');

        console.log('Script d\'extraction terminé avec succès.');
    } catch (error) {
        console.error('Une erreur est survenue lors de l\'exécution du script:', error);
    }
})();

// Fonction pour extraire les liens des clubs
async function extractClubLinks(page) {
    console.log('Début de l\'extraction des liens des clubs depuis la page...');

    return await page.evaluate(() => {
        let domain = window.location.origin;
        let links = [];

        document.querySelectorAll('table tr').forEach((tr) => {
            let clubCod = tr.querySelector('td:nth-child(2)')?.innerText?.trim();

            if (!clubCod) return;

            links.push(domain + "/pnfg/NPcd/NFG_VerClub?cod_primaria=1000118&codigo_club=" + clubCod);
        });

        return links;
    });
}

// Fonction pour extraire les données d'un club avec gestion des redirections
async function extractClubData(page, link) {
    console.log(`Accès à la page du club: ${link}`);

    let isRedirected = false;
    let redirectedUrl = '';

    // Écoute des événements "response" pour détecter les redirections 301 ou 302
    page.on('response', (response) => {
        const status = response.status();
        const responseUrl = response.url();

        if (status === 301 || status === 302) {
            isRedirected = true;
            redirectedUrl = response.headers()['location'] || responseUrl;
            console.log(`Redirection détectée vers : ${redirectedUrl}`);
        }
    });

    // Accès à la page du club
    await page.goto(link, { waitUntil: ['domcontentloaded'] });

    // Vérifier si l'URL contient "login" après la navigation
    if (isRedirected || page.url().includes('login')) {
        console.error('Redirection détectée vers une page de login ou autre.');
        throw new Error('Redirection vers page de login ou autre page non autorisée.');
    }

    console.log('Page du club chargée.');

    // Extraction des données du club
    let clubData = await page.evaluate(() => {
        let chunkOutput = [];

        let h5Elements = document.querySelectorAll('h5:has(strong)');

        let clubEmail = null;
        let clubPhone = null;
        let clubProvince = null;

        // Extraction des informations du club
        h5Elements.forEach((h5) => {
            let textContent = h5.innerText || '';
            if (textContent.includes('Email:')) {
                clubEmail = textContent.replace('Email:', '').trim();
            }

            if (textContent.includes('Teléfonos:')) {
                clubPhone = textContent.replace('Teléfonos:', '').trim();
            }

            if (textContent.includes('Provincia:')) {
                clubProvince = textContent.replace('Provincia:', '').trim();
            }
        });

        let clubName = document.querySelector('h2')?.innerText || 'Nom du club non disponible';
        let clubNbTeam = document.querySelectorAll('table.table-striped:first-child > tbody > tr').length;

        let peopleRows = document.querySelectorAll('table.table-striped:last-child tr');

        // Parcours des personnes associées au club pour en extraire les données
        peopleRows.forEach((row, index) => {
            if (index === 0) return;

            let name = row.querySelector('td:nth-child(1)')?.innerText?.trim() || 'Nom non disponible';
            let role = row.querySelector('td:nth-child(2)')?.innerText?.trim() || 'Rôle non disponible';

            chunkOutput.push({
                clubName: clubName,
                clubEmail: clubEmail,
                clubPhone: clubPhone,
                clubNomPrenom: name,
                clubRole: role,
                clubProvince: clubProvince,
                clubNbTeam: clubNbTeam,
            });
        });

        return chunkOutput;
    });

    return clubData;
}
