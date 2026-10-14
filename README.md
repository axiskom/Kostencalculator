# Batchkosten, een tool van AXISKOM

Bereken wat een batch kost, van brood tot worst en kaas. Dit is de kostenberekening uit Kaasdagboek en Worstendagboek, als losse tool. Geen account, geen server en geen tracking, alles blijft op je eigen toestel.

Na het activeren van GitHub Pages staat de tool op `https://<je-gebruikersnaam>.github.io/<repo-naam>/`.

## Wat kan de tool

- **Instellingen.** Voer je grondstoffen in met de prijs en inhoud van het pakket, bijvoorbeeld bloem, 1 kg voor € 1,20. De tool rekent dat om naar prijs per kg, per l of per stuk. Deel de grondstoffen in met eigen categorieën zoals Bakken of Koken, zoek in de lijst en klap alles in of uit. Verandert een prijs, dan zie je de vorige prijs en het verschil in procenten. Voor droge waar kun je het gewicht van 1 eetlepel invullen, zodat je ook met eetlepels en theelepels kunt rekenen.
- **Berekenen.** Kies grondstoffen in een lijst met zoekfunctie en voeg een ontbrekende grondstof meteen toe zonder het scherm te verlaten. Vul de hoeveelheid in (g, kg, ml, dl, l, stuk, tl of el), voeg eventueel overige kosten toe zoals energie of verpakking en vul de opbrengst in. Je ziet meteen de totale kost en de kost per stuk, per kg of per l. Met Schalen vermenigvuldig je alle hoeveelheden, of schaal je op een grondstof, bijvoorbeeld voor 5 kg vlees. Vul je de winkelprijs in, dan zie je wat je bespaart. Een lopende berekening wordt niet bewaard, de tool start telkens met een leeg scherm, en met de knop Leegmaken bovenaan begin je ook tussendoor opnieuw.
- **Historie.** Elke opgeslagen batch bewaart de prijzen van die dag. Je ziet ook wat dezelfde batch met de prijzen van vandaag zou kosten en hoe de kost verschilt van de vorige keer dat je dit maakte. Delen als tekst (WhatsApp, mail), afdrukken en export naar CSV voor Excel.
- **Recepten.** Sla een samenstelling op en gebruik hem opnieuw. De kost wordt telkens met de actuele prijzen herberekend. Een recept deel je als tekst.

## Gegevens en back-up

Alles staat in `localStorage` van de browser op het toestel waarop je de tool gebruikt. Wissel je van toestel of wis je de browserdata, dan is het weg. Maak daarom af en toe een back-up via Instellingen en Back-up downloaden. Dat geeft een gewoon tekstbestand (`batchkosten-backup-datum.txt`), dat je op een ander toestel terugzet met Back-up terugzetten. Oudere back-ups als `.json` worden nog steeds gelezen. Op een telefoon of tablet kun je de back-up ook delen via het deelmenu, bijvoorbeeld naar Google Drive, WhatsApp of e-mail. Een automatische koppeling met een cloud is er bewust niet, want dat vraagt om een account en haalt het voordeel van alles op je eigen toestel weg.

Gegevens horen bij het adres waarop de tool draait. Een andere URL betekent een lege tool tot je een back-up terugzet.

## Online zetten met GitHub Pages

Er is geen build-stap. Dit zijn de bestanden die in de repo moeten staan, in de hoofdmap.

| Bestand | Waarvoor |
|---|---|
| `index.html` | de pagina |
| `style.css` | opmaak en kleuren |
| `app.js` | alle logica |
| `sw.js` | werkt offline en maakt installeren mogelijk |
| `manifest.webmanifest` | naam, kleuren en icoon van de geïnstalleerde app |
| `icons/apple-touch-icon.png` | icoon voor het startscherm van een iPhone |
| `icons/favicon-64.png` | icoontje in het browsertabblad |
| `icons/icon-192.png` | app-icoon |
| `icons/icon-512.png` | app-icoon, groot |
| `icons/logo-96.png` | het AXISKOM-logo in de kopbalk |
| `README.md` | deze uitleg |

De map `.claude` is alleen voor lokaal gebruik en hoeft niet mee. Alle paden in de bestanden zijn relatief, dus de tool werkt ook in een submap zoals `gebruiker.github.io/repo-naam/`.

1. Zet de bestanden in de repo, in de hoofdmap en met de map `icons` erbij.
2. Ga in de repo naar Settings, Pages en kies bij Source de branch `main` en de map `/ (root)`.
3. Na ongeveer een minuut staat de tool op het adres dat GitHub daar toont.
4. Op een telefoon open je dat adres in de browser en kies je Toevoegen aan startscherm.

## Huisstijl

De kleuren komen van axiskom.nl en staan als variabelen bovenaan `style.css`.

| Rol | Kleur |
|---|---|
| Achtergrond (zand) | `#E4D5B7` |
| Tekst (petrol) | `#1B3A4B` |
| Kop en knoppen (groen) | `#3C6E47` |
| Accent (oranje) | `#D35400` |

Waar oranje als tekst of op een donkere balk staat, is hij iets donkerder (`#9A3E00`) of helderder (`#FE6704`) gemaakt voor het contrast. De tool is bewust altijd beige, net als de site, er is geen donker thema. De lettertypes van de site (Montserrat en Open Sans) worden bewust niet geladen, zodat de tool offline werkt en er geen verbinding met derden is. Staan ze op het toestel, dan worden ze gebruikt, anders valt de tool terug op het systeemlettertype.

## Logo en icoon

Het ronde AXISKOM-logo (`icons/logo-96.png`, van axiskom.nl) staat alleen in de kopbalk van de pagina. Het app-icoon, de favicon en het icoon op het startscherm zijn bewust het euroteken, zodat deze tool niet verward wordt met de andere AXISKOM-tool die het logo als icoon gebruikt.

## Lokaal draaien

```bash
python -m http.server 5190
```

Open daarna `http://localhost:5190`. Het installeren als app en het delen van een back-up werken alleen op een beveiligd adres, dus op `https` of `localhost`, en niet als je `index.html` rechtstreeks als bestand opent.

## Wijzigen

Pas je een bestand aan, verhoog dan `CACHE` in `sw.js`, anders blijven bestaande gebruikers de oude versie uit de cache zien. Na een update moet de pagina één of twee keer worden ververst om de nieuwe versie te tonen.
