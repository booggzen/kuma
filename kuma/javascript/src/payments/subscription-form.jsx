// @flow
import * as React from 'react';
import { useContext, useEffect, useRef, useState } from 'react';

import { getLocale, gettext, Interpolated } from '../l10n.js';
import UserProvider from '../user-provider.jsx';
import { getCookie } from '../utils';

const SUBSCRIPTION_URL = '/api/v1/subscriptions';

/**
 * Loads the script given by the URL and cleans up after itself
 * @returns {(null | Promise)} Indicating whether the script has successfully loaded
 */
function useScriptLoading(url) {
    const [loadingPromise, setLoadingPromise] = useState<null | Promise<void>>(
        null
    );
    useEffect(() => {
        let script;
        if (!loadingPromise) {
            script = document.createElement('script');
            setLoadingPromise(
                new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                })
            );
            script.src = url;

            if (document.head) {
                document.head.appendChild(script);
            }
        }
        return () => {
            if (document.head && script) {
                document.head.removeChild(script);
            }
        };
    }, [loadingPromise, url]);

    return [loadingPromise, () => setLoadingPromise(null)];
}

const STRIPE_CONTINUE_SESSIONSTORAGE_KEY = 'stripe-form-continue';

/**
 * Return true if you have a sessionStorage key that says you can go straight
 * to continue the Stripe subscription form.
 * This also has the side-effect that once you call it, it demolishes that
 * sessionStorage.
 */
function popStripeContinuation() {
    try {
        let autoTriggerStripe = JSON.parse(
            sessionStorage.getItem(STRIPE_CONTINUE_SESSIONSTORAGE_KEY) ||
                'false'
        );
        sessionStorage.removeItem(STRIPE_CONTINUE_SESSIONSTORAGE_KEY);
        return autoTriggerStripe;
    } catch (e) {
        // If sessionStorage is not supported, they'll have to manually click
        // the Continue button again.
        return false;
    }
}

/**
 * Remembers, in sessionStorage, that the user can continue the Stripe
 * subscription form next time they come back.
 */
function pushStripeContinuation() {
    try {
        sessionStorage.setItem(STRIPE_CONTINUE_SESSIONSTORAGE_KEY, 'true');
    } catch (e) {
        // No sessionStorage, no remembering to trigger opening the Stripe
        // form automatically next time.
    }
}

export default function SubscriptionForm() {
    const userData = useContext(UserProvider.context);
    const locale = getLocale();

    const [paymentAuthorized, setPaymentAuthorized] = useState(false);
    const [formStep, setFormStep] = useState<
        'initial' | 'stripe_error' | 'stripe' | 'submitting' | 'server_error'
    >('initial');

    const token = useRef(null);

    const [stripeLoadingPromise, reloadStripe] = useScriptLoading(
        'https://checkout.stripe.com/checkout.js'
    );

    useEffect(() => {
        if (!stripeLoadingPromise) {
            return;
        }
        stripeLoadingPromise
            .then(() => {
                if (formStep === 'stripe_error') {
                    setFormStep('initial');
                }
            })
            .catch(() => {
                setFormStep('stripe_error');
            });
    }, [formStep, stripeLoadingPromise]);

    /**
     * If you arrived on this page, being anonymous, you'd have to first sign in.
     * Suppose that you do that, we will make sure to send you back to this page
     * with the sessionStorage key set.
     * Basically, if you have that sessionStorage key, it will, for you, check the
     * checkbox and press the "Continue" button.
     */

    useEffect(() => {
        if (userData && userData.isAuthenticated && popStripeContinuation()) {
            setPaymentAuthorized(true);
            setOpenStripeModal(true);
        }
    }, [userData]);

    const [openStripeModal, setOpenStripeModal] = useState(false);
    useEffect(() => {
        function createSubscription() {
            fetch(SUBSCRIPTION_URL, {
                method: 'POST',
                body: JSON.stringify({
                    stripe_token: token.current, // eslint-disable-line camelcase
                }),
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                    'Content-Type': 'application/json',
                },
            }).then((response) => {
                if (response.ok) {
                    window.location = `/${locale}/payments/thank-you/`;
                } else {
                    console.error(
                        'error while creating subscription',
                        response.statusText
                    );
                    setFormStep('server_error');
                }
            });
        }

        if (stripeLoadingPromise && openStripeModal) {
            setFormStep('stripe');
            stripeLoadingPromise.then(() => {
                const stripeHandler = window.StripeCheckout.configure({
                    key: window.mdn.stripePublicKey,
                    locale,
                    name: 'MDN Web Docs',
                    zipCode: true,
                    currency: 'usd',
                    amount: 500,
                    email: userData ? userData.email : '',
                    // token is only called if Stripe was able to successfully
                    // create a token from the entered info
                    token(response) {
                        token.current = response.id;
                        createSubscription();
                    },
                    closed() {
                        setFormStep(token.current ? 'submitting' : 'initial');
                    },
                });
                stripeHandler.open();
            });
        }
    }, [stripeLoadingPromise, openStripeModal, userData, locale]);

    function handleSubmit(event) {
        event.preventDefault();
        // Not so fast! If you're not authenticated yet, trigger the
        // authentication modal instead.
        if (userData && userData.isAuthenticated) {
            setOpenStripeModal(true);
        } else {
            pushStripeContinuation();
            const next = encodeURIComponent(window.location.pathname);
            if (window.mdn && window.mdn.triggerAuthModal) {
                window.mdn.triggerAuthModal(
                    gettext(
                        "Sign in to support MDN. If you haven't already created an account, you will be prompted to do so after signing in."
                    )
                );
            } else {
                // If window.mdn.triggerAuthModal is falsy, it most likely means
                // it deliberately doesn't want this user to use a modal. E.g.
                // certain mobile clients.
                window.location.href = `/${locale}/users/account/signup-landing?next=${next}`;
            }
        }
    }

    let content;
    if (formStep === 'server_error') {
        content = (
            <section className="error">
                <h2>{gettext('Sorry!')}</h2>
                <p>
                    {gettext(
                        "An error occurred trying to set up the subscription with Stripe's server. We've recorded the error and will investigate it."
                    )}
                </p>
                <button
                    type="button"
                    className="button cta primary"
                    onClick={() => setFormStep('initial')}
                >
                    {gettext('Try again')}
                </button>
            </section>
        );
    } else if (formStep === 'stripe_error') {
        content = (
            <section className="error">
                <h2>{gettext('Sorry!')}</h2>
                <p>
                    {gettext(
                        'An error happened trying to load the Stripe integration'
                    )}
                </p>
                <button
                    type="button"
                    className="button cta primary"
                    onClick={reloadStripe}
                >
                    {gettext('Try again')}
                </button>
            </section>
        );
    } else {
        content = (
            <form
                method="post"
                onSubmit={handleSubmit}
                data-testid="subscription-form"
            >
                <label className="payment-opt-in">
                    <input
                        type="checkbox"
                        required
                        checked={paymentAuthorized}
                        onChange={(event) => {
                            setPaymentAuthorized(event.target.checked);
                        }}
                    />
                    <small>
                        <Interpolated
                            id={gettext(
                                'By clicking this button, I authorize Mozilla to charge this payment method each month, according to the <paymentTermsLink />, until I cancel my subscription.'
                            )}
                            paymentTermsLink={
                                <a
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    href={`/${locale}/payments/terms/`}
                                >
                                    {gettext('Payment Terms')}
                                </a>
                            }
                        />
                    </small>
                </label>
                <button type="submit" className="button cta primary">
                    {gettext(
                        formStep === 'submitting' ? 'Submitting...' : 'Continue'
                    )}
                </button>
                <small className="subtext">
                    {gettext('Payments are not tax deductible')}
                </small>
            </form>
        );
    }

    return (
        <div className="subscriptions-form">
            <header className="subscriptions-form-header">
                <h2>
                    <Interpolated
                        id={gettext('$5 <perMontSub />')}
                        perMontSub={<sub>{gettext('/mo')}</sub>}
                    />
                </h2>
            </header>
            {content}
        </div>
    );
}
